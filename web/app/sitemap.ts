import type { MetadataRoute } from 'next';
// A private notebook does not advertise its contents to search engines.
export default function sitemap(): MetadataRoute.Sitemap {
  return [];
}
