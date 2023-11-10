/**
 * Copyright 2023 Fluence Labs Limited
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Flags } from "@oclif/core";

import { BaseCommand, baseFlags } from "../../baseCommand.js";
import { commandObj } from "../../lib/commandObj.js";
import { CLI_NAME_FULL, CLI_NAME } from "../../lib/const.js";
import {
  getRecommendedDependencies,
  resolveDependencies,
} from "../../lib/helpers/package.js";
import { initCli } from "../../lib/lifeCycle.js";
import CLIPackageJSON from "../../versions/cli.package.json" assert { type: "json" };
import JSClientPackageJSON from "../../versions/js-client.package.json" assert { type: "json" };
import { versions } from "../../versions.js";

export default class Versions extends BaseCommand<typeof Versions> {
  static override aliases = ["dep:v"];
  static override description = "Get versions of all dependencies";
  static override examples = ["<%= config.bin %> <%= command.id %>"];
  static override flags = {
    ...baseFlags,
    default: Flags.boolean({
      description:
        "Display default npm and cargo dependencies and their versions for current CLI version. Default npm dependencies are always available to be imported in Aqua",
    }),
  };
  async run(): Promise<void> {
    const { flags, maybeFluenceConfig } = await initCli(
      this,
      await this.parse(Versions),
    );

    const { yamlDiffPatch } = await import("yaml-diff-patch");

    if (flags.default) {
      commandObj.log(
        yamlDiffPatch(
          "",
          {},
          {
            "cli version": commandObj.config.version,
            "default npm dependencies. Can be overridden with 'fluence dependency npm install <name>@<version>'":
              getRecommendedDependencies("npm"),
            "default cargo dependencies. Can be overridden with 'fluence dependency cargo install <name>@<version>'":
              getRecommendedDependencies("cargo"),
          },
        ),
      );

      return;
    }

    commandObj.log(
      yamlDiffPatch(
        "",
        {},
        {
          [`${CLI_NAME_FULL} version`]: commandObj.config.version,
          "nox version": versions["nox"],
          "rust toolchain": versions["rust-toolchain"],
          [`npm dependencies that can be overridden with \`${CLI_NAME} dependency npm install <name>@<version>\``]:
            await resolveDependencies("npm", maybeFluenceConfig, true),
          [`cargo dependencies that can be overridden with \`${CLI_NAME} dependency cargo install <name>@<version>\``]:
            await resolveDependencies("cargo", maybeFluenceConfig, true),
          "internal dependencies": filterOutNonFluenceDependencies(
            CLIPackageJSON.dependencies,
          ),
          "dev dependencies": filterOutNonFluenceDependencies(
            CLIPackageJSON.devDependencies,
          ),
          "js-client dependencies": filterOutNonFluenceDependencies(
            JSClientPackageJSON.dependencies,
          ),
        },
      ),
    );
  }
}

const filterOutNonFluenceDependencies = (
  dependencies: Record<string, string>,
) => {
  return Object.fromEntries(
    Object.entries(dependencies).filter(([dep]) => {
      return dep.startsWith("@fluencelabs/");
    }),
  );
};