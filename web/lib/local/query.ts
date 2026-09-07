// Compatibility boundary for the existing repository queries. No network calls or SQL supplied by clients.
import {
  rows,
  insert,
  update,
  remove,
  transaction,
  type Row,
} from './database';

type Result = {
  data: any;
  error: { message: string; code?: string } | null;
  count?: number;
};
type Predicate = (row: Row) => boolean;
export function splitExpressions(text: string) {
  const parts: string[] = [];
  let start = 0,
    depth = 0,
    quoted = false,
    escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (quoted) continue;
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}
const foreign: Record<string, string> = {
  subject_id: 'subjects',
  problem_id: 'problems',
  tag_id: 'tags',
  problem_set_id: 'problem_sets',
  user_id: 'user_profiles',
  session_state_id: 'review_session_state',
};
const primary: Record<string, string> = {
  subjects: 'subject_id',
  problems: 'problem_id',
  tags: 'tag_id',
  problem_sets: 'problem_set_id',
  user_profiles: 'user_id',
  review_session_state: 'session_state_id',
};

function relation(
  table: string,
  row: Row,
  name: string
): { table: string; value: Row | Row[] | null } {
  if (foreign[name])
    return {
      table: foreign[name],
      value: rows(foreign[name]).find(r => r.id === row[name]) || null,
    };
  const target = name.split('!')[0];
  const explicit = name.split('!').find(p => foreign[p]);
  const key = explicit || primary[target];
  if (key && Object.hasOwn(row, key))
    return {
      table: target,
      value: rows(target).find(r => r.id === row[key]) || null,
    };
  const reverse = primary[table];
  if (reverse)
    return {
      table: target,
      value: rows(target).filter(r => r[reverse] === row.id),
    };
  throw new Error(`Unsupported relation ${table}.${name}`);
}
function project(table: string, row: Row, selection: string): Row | null {
  const output: Row = {};
  for (const part of splitExpressions(selection)) {
    if (part === '*') {
      Object.assign(output, row);
      continue;
    }
    const match = part.match(/^([^()]+)\((.*)\)$/s);
    if (match) {
      const [alias, target] = match[1].includes(':')
        ? match[1].split(':')
        : [match[1].split('!')[0], match[1]];
      const related = relation(table, row, target.trim());
      const value = Array.isArray(related.value)
        ? match[2].trim() === 'count'
          ? [{ count: related.value.length }]
          : related.value
              .map(r => project(related.table, r, match[2]))
              .filter(Boolean)
        : related.value
          ? project(related.table, related.value, match[2])
          : null;
      if (
        target.includes('!inner') &&
        (!value || (Array.isArray(value) && !value.length))
      )
        return null;
      output[alias.trim()] = value;
    } else {
      const [alias, key] = part.includes(':') ? part.split(':') : [part, part];
      output[alias.trim()] = row[key.trim()] ?? null;
    }
  }
  return output;
}
function valueAt(table: string, row: Row, column: string): any {
  const [first, ...rest] = column.split('.');
  if (!rest.length) return row[first];
  const rel = relation(table, row, first);
  return Array.isArray(rel.value)
    ? rel.value.map(r => valueAt(rel.table, r, rest.join('.')))
    : rel.value
      ? valueAt(rel.table, rel.value, rest.join('.'))
      : null;
}
function comparison(actual: any, operator: string, expected: any): boolean {
  if (Array.isArray(actual) && !['contains', 'overlaps'].includes(operator))
    return actual.some(v => comparison(v, operator, expected));
  switch (operator) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual != null && actual !== expected;
    case 'is':
      return expected === null ? actual == null : actual === expected;
    case 'in':
      return expected.includes(actual);
    case 'gt':
      return actual != null && actual > expected;
    case 'gte':
      return actual != null && actual >= expected;
    case 'lt':
      return actual != null && actual < expected;
    case 'lte':
      return actual != null && actual <= expected;
    case 'ilike':
    case 'like': {
      const pattern = String(expected)
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/%/g, '.*')
        .replace(/_/g, '.');
      return new RegExp(`^${pattern}$`, operator === 'ilike' ? 'is' : 's').test(
        String(actual ?? '')
      );
    }
    case 'contains':
      return (
        Array.isArray(actual) &&
        expected.every((e: any) =>
          actual.some(a =>
            typeof e === 'object'
              ? Object.entries(e).every(([k, v]) => a[k] === v)
              : a === e
          )
        )
      );
    case 'overlaps':
      return (
        Array.isArray(actual) && expected.some((e: any) => actual.includes(e))
      );
    default:
      throw new Error(`Unsupported filter ${operator}`);
  }
}
function expression(table: string, text: string): Predicate {
  const group = text.match(/^(and|or)\((.*)\)$/s);
  if (group) {
    const terms = splitExpressions(group[2]).map(t => expression(table, t));
    return r =>
      group[1] === 'and' ? terms.every(f => f(r)) : terms.some(f => f(r));
  }
  const match = text.match(
    /^([\w.]+?)\.(not\.)?(eq|neq|is|in|gt|gte|lt|lte|ilike|like)\.(.*)$/s
  );
  if (!match) throw new Error(`Unsupported filter expression: ${text}`);
  const [, column, negate, op, raw] = match;
  let value: any = raw;
  if (raw.startsWith('"')) value = JSON.parse(raw);
  else if (raw === 'null') value = null;
  else if (raw === 'true' || raw === 'false') value = raw === 'true';
  else if (op === 'in') value = splitExpressions(raw.slice(1, -1));
  return row => comparison(valueAt(table, row, column), op, value) !== !!negate;
}

export class LocalQuery implements PromiseLike<Result> {
  private filters: Predicate[] = [];
  private selection = '*';
  private action = 'select';
  private payload: Row[] = [];
  private conflict = 'id';
  private ignoreDuplicates = false;
  private sorting: {
    column: string;
    ascending: boolean;
    nullsFirst: boolean;
  }[] = [];
  private offset = 0;
  private size = Infinity;
  private cardinality = '';
  private head = false;
  private pending?: Promise<Result>;
  constructor(private table: string) {}
  select(selection = '*', options: Row = {}) {
    this.selection = selection;
    this.head = options.head || false;
    return this;
  }
  insert(value: Row | Row[]) {
    this.action = 'insert';
    this.payload = Array.isArray(value) ? value : [value];
    return this;
  }
  upsert(value: Row | Row[], options: Row = {}) {
    this.insert(value);
    this.action = 'upsert';
    this.conflict = options.onConflict || 'id';
    this.ignoreDuplicates = !!options.ignoreDuplicates;
    return this;
  }
  update(value: Row) {
    this.action = 'update';
    this.payload = [value];
    return this;
  }
  delete() {
    this.action = 'delete';
    return this;
  }
  filter(column: string, operator: string, value: any) {
    this.filters.push(r =>
      comparison(valueAt(this.table, r, column), operator, value)
    );
    return this;
  }
  eq(c: string, v: any) {
    return this.filter(c, 'eq', v);
  }
  neq(c: string, v: any) {
    return this.filter(c, 'neq', v);
  }
  in(c: string, v: any[]) {
    return this.filter(c, 'in', v);
  }
  is(c: string, v: any) {
    return this.filter(c, 'is', v);
  }
  gt(c: string, v: any) {
    return this.filter(c, 'gt', v);
  }
  gte(c: string, v: any) {
    return this.filter(c, 'gte', v);
  }
  lt(c: string, v: any) {
    return this.filter(c, 'lt', v);
  }
  lte(c: string, v: any) {
    return this.filter(c, 'lte', v);
  }
  ilike(c: string, v: any) {
    return this.filter(c, 'ilike', v);
  }
  contains(c: string, v: any) {
    return this.filter(c, 'contains', v);
  }
  overlaps(c: string, v: any) {
    return this.filter(c, 'overlaps', v);
  }
  not(c: string, op: string, v: any) {
    this.filters.push(
      r =>
        !comparison(
          valueAt(this.table, r, c),
          op,
          op === 'in' && typeof v === 'string'
            ? splitExpressions(v.slice(1, -1))
            : v
        )
    );
    return this;
  }
  or(text: string) {
    const terms = splitExpressions(text).map(t => expression(this.table, t));
    this.filters.push(r => terms.some(f => f(r)));
    return this;
  }
  match(values: Row) {
    for (const [k, v] of Object.entries(values)) this.eq(k, v);
    return this;
  }
  order(column: string, options: Row = {}) {
    this.sorting.push({
      column,
      ascending: options.ascending !== false,
      nullsFirst: options.nullsFirst === true,
    });
    return this;
  }
  range(from: number, to: number) {
    this.offset = from;
    this.size = to - from + 1;
    return this;
  }
  limit(size: number) {
    this.size = size;
    return this;
  }
  single() {
    this.cardinality = 'single';
    return this;
  }
  maybeSingle() {
    this.cardinality = 'maybe';
    return this;
  }
  private run(): Result {
    try {
      const execute = () => {
        let result = rows(this.table).filter(r =>
          this.filters.every(f => f(r))
        );
        if (this.action === 'insert' || this.action === 'upsert') {
          result = this.payload.map(input => {
            const keys = this.conflict.split(',').map(k => k.trim());
            const previous =
              this.action === 'upsert' &&
              rows(this.table).find(r =>
                keys.every(k => input[k] !== undefined && r[k] === input[k])
              );
            return previous
              ? this.ignoreDuplicates
                ? previous
                : update(this.table, previous, input)
              : insert(this.table, input);
          });
        } else if (this.action === 'update')
          result = result.map(r => update(this.table, r, this.payload[0]));
        else if (this.action === 'delete')
          result.forEach(r => remove(this.table, r));
        for (const sort of [...this.sorting].reverse())
          result.sort((a, b) => {
            const x = valueAt(this.table, a, sort.column),
              y = valueAt(this.table, b, sort.column);
            if (x == null || y == null)
              return x == null && y == null
                ? 0
                : (x == null ? -1 : 1) * (sort.nullsFirst ? 1 : -1);
            return (x < y ? -1 : x > y ? 1 : 0) * (sort.ascending ? 1 : -1);
          });
        let projected = result
          .map(r => project(this.table, r, this.selection))
          .filter(Boolean);
        const count = projected.length;
        projected = projected.slice(
          this.offset,
          this.size === Infinity ? undefined : this.offset + this.size
        );
        if (
          this.cardinality &&
          (projected.length > 1 ||
            (this.cardinality === 'single' && !projected.length))
        )
          return {
            data: null,
            count,
            error: { message: 'Expected one record', code: 'PGRST116' },
          };
        return {
          data: this.head
            ? null
            : this.cardinality
              ? projected[0] || null
              : projected,
          count,
          error: null,
        };
      };
      return this.action === 'select' ? execute() : transaction(execute);
    } catch (error) {
      return {
        data: null,
        error: {
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
  then<TResult1 = Result, TResult2 = never>(
    onfulfilled?: ((value: Result) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): PromiseLike<TResult1 | TResult2> {
    this.pending ??= Promise.resolve().then(() => this.run());
    return this.pending.then(onfulfilled, onrejected);
  }
}
