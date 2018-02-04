import { Dataset } from "./dataset";

export type DatasetMeta = {
  slug: string;
  dataDir: string;
  dataset: Dataset;
  repoDir: string;
};

export { Dataset } from "./dataset";

export function repoFromSlug(slug: string) {
  return `typeguard/typed-${slug}`;
}
