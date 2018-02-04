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
    yield `## ${name}`;
    yield ``;

    for (const meta of category) {
      let simpleUrl = meta.dataset.url.split("//")[1];
      if (simpleUrl.endsWith("/")) {
        simpleUrl = simpleUrl.substr(0, simpleUrl.length - 1);
      }

      yield `* [${meta.dataset.name}](https://github.com/typeguard/types-${
        meta.slug
      }) (${simpleUrl})`;
    }
  }

  function* generate() {
    yield `# Awesome Typed Datasets [![Awesome](https://cdn.rawgit.com/sindresorhus/awesome/d7305f38d29fed78fa85652e3a63e154dd8e8829/media/badge.svg)](https://github.com/sindresorhus/awesome)`;

    const displayNames = languages
      .map(l => l.displayName)
      .filter(d => d !== "Simple Types");
    const nameList =
      displayNames.slice(1).join(", ") + ", and " + displayNames[0];

    yield* [
      ``,
      `These are public JSON datasets that have been strongly`,
      `typed with [quicktype](https://github.com/quicktype/quicktype).`,
      `Each is a repo with code in ${nameList} for`,
      `reading and writing the JSON produced by these APIs.`,
      ``
    ];

    for (const name of Object.keys(categories).sort()) {
      yield* categoryList(name, categories[name]);
    }

    yield* [
      ``,
      `## Contributing`,
      `If you want to contribute, please read the [contribution guidelines](CONTRIBUTING.md).`,
      ``,
      `## License`,
      `[![CC0](http://mirrors.creativecommons.org/presskit/buttons/88x31/svg/cc-zero.svg)](https://creativecommons.org/publicdomain/zero/1.0/)`,
      ``
    ];
  }

  return Array.from(generate()).join("\n");
}

function main() {
  rm("-rf", "repos");
  mkdir("repos");

  // TODO make this work as an iterator
  const datasets = Array.from(getDatasets());

  fs.writeFileSync("README.md", readme(datasets));

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
}

main();
