import { languages } from "quicktype";

import { Dataset, DatasetMeta, repoFromSlug } from "./common";
import * as lo from "lodash";

export default function readme(data: DatasetMeta[]): string {
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

      yield `* [${meta.dataset.name}](https://github.com/${repoFromSlug(
        meta.slug
      )}) (${simpleUrl})`;
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
