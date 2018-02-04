import { Dataset } from "./dataset";
import { TargetLanguage } from "quicktype";

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

export function languageShortname(language: TargetLanguage) {
  return language.names.sort((x, y) => y.length - x.length)[0];
}
