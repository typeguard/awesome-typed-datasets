import { pwd, cd, exec, mv, cp, rm, cat, find, mkdir, chmod } from "shelljs";

import * as path from "path";
import * as fs from "fs";

import * as lo from "lodash";
import { Dataset, Convert } from "./dataset";

import { languages } from "quicktype";
import { TargetLanguage } from "quicktype/dist/TargetLanguage";

const QUICKTYPE_BIN = path.resolve("node_modules/.bin/quicktype");
const DATASET_CACHE = "datasets-cache";

const QUICKTYPE_VERSION = JSON.parse(
  fs.readFileSync("package-lock.json", "utf8")
).dependencies.quicktype.version;

type DatasetMeta = {
  slug: string;
  dataDir: string;
  dataset: Dataset;
  repoDir: string;
};

function execho(command: string) {
  console.error(command);
  return exec(command);
}

function hub(command: string) {
  return execho(`hub ${command}`);
}

function quicktype(command: string) {
  console.error(`quicktype ${command}`);
  return exec(`${QUICKTYPE_BIN} ${command}`);
}

function repoFromSlug(slug: string) {
  return `typeguard/types-${slug}`;
}

function remoteFromSlug(slug: string) {
  return `git@github.com:${repoFromSlug(slug)}`;
}

function shortname(language: TargetLanguage) {
  return language.names.sort((x, y) => y.length - x.length)[0];
}

function precacheDataDirectory(dataDir: string) {
  mkdir("-p", DATASET_CACHE);
  const target = path.join(DATASET_CACHE, path.basename(dataDir));
  rm("-rf", target);
  cp("-r", dataDir, target);
  rm(path.join(target, "index.json"));
  // Pre-download URLs
  for (const urlFile of find(`${target}/**.url`)) {
    const url = cat(urlFile).stdout.trim();
    const jsonFile = urlFile.replace(".url", ".json");
    exec(`curl "${url}" -o "${jsonFile}"`);
    rm(urlFile);
  }
  return target;
}

function within(dir: string, work: () => void) {
  const cwd = pwd();
  cd(dir);
  work();
  cd(cwd);
}

function cloneOrCreateRepo(dataset: Dataset, slug: string, directory: string) {
  const cloneResult = hub(`clone ${remoteFromSlug(slug)} ${directory}`);
  if (cloneResult.code === 0) return;

  mkdir("-p", directory);
  within(directory, () => {
    hub("init");
    hub(`commit --allow-empty -m create`);
    hub(
      `create typeguard/types-${slug} -d "${dataset.name}" -h "${dataset.url}"`
    );
    hub("push --set-upstream origin master");
  });
}

function* getDatasets() {
  for (const index of find("datasets/**/index.json")) {
    const dataset = Convert.toDataset(fs.readFileSync(index, "utf8"));
    const dataDir = path.dirname(index);
    const slug = path.basename(dataDir);
    yield {
      slug,
      repoDir: `repos/types-${slug}`,
      dataDir,
      dataset
    };
  }
}

function readme(data: DatasetMeta[]): string {
  const categories = lo.groupBy(data, d => d.dataset.category);

  function* categoryList(name: string, category: DatasetMeta[]) {
    yield ``;
    yield `### ${name}`;
    yield ``;
    for (const meta of category) {
      yield `* [${meta.dataset.name}](https://github.com/typeguard/types-${
        meta.slug
      })`;
    }
  }

  function* generate() {
    yield `# Awesome Typed Data`;
    for (const name of Object.keys(categories)) {
      yield* categoryList(name, categories[name]);
    }
  }

  return Array.from(generate()).join("\n");
}

function main() {
  rm("-rf", "repos");
  mkdir("repos");

  // TODO make this work as an iterator
  const datasets = Array.from(getDatasets());

  for (const { slug, dataDir, dataset, repoDir } of datasets) {
    const scriptFile = path.join(repoDir, "quicktype.sh");
    const cachedDataDir = precacheDataDirectory(dataDir);

    cloneOrCreateRepo(dataset, slug, repoDir);

    const targetDataDir = path.join(repoDir, "data");
    rm("-rf", targetDataDir);
    cp("-r", dataDir, targetDataDir);
    rm(path.join(targetDataDir, "index.json"));

    let script = ["#!/bin/bash", ""];

    for (const language of languages) {
      const langName = shortname(language);
      const languageDir = path.join(repoDir, langName);
      const mainFile = path.join(languageDir, `${slug}.${language.extension}`);

      rm("-rf", languageDir);
      mkdir(languageDir);

      quicktype(`${cachedDataDir} -o ${mainFile}`);

      script.push(
        `quicktype data -o ${path.join(langName, path.basename(mainFile))}`
      );
    }

    fs.writeFileSync(scriptFile, script.join("\n"));
    chmod("+x", scriptFile);

    within(repoDir, () => {
      const hasChanges = exec("git status --porcelain").stdout.length > 0;
      if (hasChanges) {
        hub("add .");
        hub(`commit -am "update (quicktype ${QUICKTYPE_VERSION})"`);
        hub("push");
      }
    });
  }

  fs.writeFileSync("README.md", readme(datasets));
}

main();
