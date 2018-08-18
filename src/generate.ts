import { pwd, cd, exec, mv, cp, rm, cat, find, mkdir, chmod } from "shelljs";

import * as path from "path";
import * as fs from "fs";
import * as lo from "lodash";

import { Dataset, Convert } from "./dataset";
import { repoFromSlug, DatasetMeta, languageShortname } from "./common";
import * as readme from "./readme";

import { defaultTargetLanguages } from "quicktype/dist/quicktype-core";

const QUICKTYPE_BIN = path.resolve("node_modules/.bin/quicktype");
const DATASET_CACHE = "datasets-cache";

const QUICKTYPE_VERSION = JSON.parse(
  fs.readFileSync("package-lock.json", "utf8")
).dependencies.quicktype.version;

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

function remoteFromSlug(slug: string) {
  return `git@github.com:${repoFromSlug(slug)}`;
}

function precacheDataDirectory({ dataDir, dataset }: DatasetMeta) {
  mkdir("-p", DATASET_CACHE);
  const target = path.join(DATASET_CACHE, path.basename(dataDir));
  rm("-rf", target);
  cp("-r", dataDir, target);
  rm(path.join(target, "index.json"));
  // Pre-download URLs
  for (const urlFile of find(`${target}/**/*.url`)) {
    const url = fs.readFileSync(urlFile, "utf8").trim();
    const jsonFile = urlFile.replace(".url", ".json");
    mkdir("-p", path.dirname(urlFile));

    let authenticate = "";
    if (dataset.oauth !== undefined) {
      const token = process.env[dataset.oauth];
      authenticate = `-H "Authorization: Bearer ${token}"`;
    }
    exec(
      `curl -X GET "${url}" -H "Accept: application/json" -o "${jsonFile}" ${authenticate}`
    );

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

function cloneOrCreateRepo({ repoDir, slug, dataset }: DatasetMeta) {
  const cloneResult = hub(`clone ${remoteFromSlug(slug)} ${repoDir}`);
  if (cloneResult.code === 0) return;

  mkdir("-p", repoDir);
  within(repoDir, () => {
    hub("init");
    hub(`commit --allow-empty -m create`);
    hub(
      `create ${repoFromSlug(slug)} -d "${dataset.name}" -h "${dataset.url}"`
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

function main(slugs: string[]) {
  rm("-rf", "repos");
  mkdir("repos");

  // TODO make this work as an iterator
  let datasets = Array.from(getDatasets());
  fs.writeFileSync("README.md", readme.main(datasets));

  if (slugs.length > 0) {
    datasets = datasets.filter(m => lo.includes(slugs, m.slug));
  }

  for (const meta of datasets) {
    const scriptFile = path.join(meta.repoDir, "quicktype.sh");
    const cachedDataDir = precacheDataDirectory(meta);

    cloneOrCreateRepo(meta);

    const targetDataDir = path.join(meta.repoDir, "data");
    rm("-rf", targetDataDir);
    cp("-r", meta.dataDir, targetDataDir);
    rm(path.join(targetDataDir, "index.json"));

    let script = ["#!/bin/bash", ""];

    for (const language of defaultTargetLanguages) {
      const langName = languageShortname(language);
      const languageDir = path.join(meta.repoDir, langName);
      const mainFile = path.join(
        languageDir,
        `${meta.slug}.${language.extension}`
      );

      rm("-rf", languageDir);
      mkdir(languageDir);

      quicktype(`${cachedDataDir} -o ${mainFile}`);

      script.push(
        `quicktype data -o ${path.join(langName, path.basename(mainFile))}`
      );
    }

    fs.writeFileSync(scriptFile, script.join("\n"));
    chmod("+x", scriptFile);

    fs.writeFileSync(
      path.join(meta.repoDir, "README.md"),
      readme.dataset(meta)
    );

    within(meta.repoDir, () => {
      const hasChanges = exec("git status --porcelain").stdout.length > 0;
      if (hasChanges) {
        hub("add .");
        hub(`commit -am "update (quicktype ${QUICKTYPE_VERSION})"`);
        hub("push");
      }
    });
  }
}

main(process.argv.slice(2));
