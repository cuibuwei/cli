/**
 * Copyright 2024 Fluence DAO
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

import assert from "node:assert";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { color } from "@oclif/color";
import type { AnySchema, JSONSchemaType, ValidateFunction } from "ajv";

import { validationErrorToString } from "../ajvInstance.js";
import { commandObj } from "../commandObj.js";
import { FS_OPTIONS, SCHEMAS_DIR_NAME, YAML_EXT, YML_EXT } from "../const.js";
import { jsonStringify, removeProperties } from "../helpers/utils.js";
import type { ValidationResult } from "../helpers/validations.js";
import type { Mutable } from "../typeHelpers.js";

import { userConfig } from "./globalConfigs.js";

type EnsureSchemaArg = {
  name: string;
  configDirPath: string;
  getSchemaDirPath: GetPath | undefined;
  schema: AnySchema;
};

const ensureSchema = async ({
  name,
  configDirPath,
  getSchemaDirPath,
  schema,
}: EnsureSchemaArg): Promise<string> => {
  const schemaDir = join(
    getSchemaDirPath === undefined ? configDirPath : await getSchemaDirPath(),
    SCHEMAS_DIR_NAME,
  );

  await mkdir(schemaDir, { recursive: true });
  const schemaPath = join(schemaDir, `${name}.json`);
  const correctSchemaContent = jsonStringify(schema) + "\n";

  try {
    const schemaContent = await readFile(schemaPath, FS_OPTIONS);
    assert(schemaContent === correctSchemaContent);
  } catch {
    await writeFile(schemaPath, correctSchemaContent, FS_OPTIONS);
  }

  return relative(configDirPath, schemaPath);
};

type MigrateConfigOptions<
  Config extends BaseConfig,
  LatestConfig extends BaseConfig,
> = {
  configString: string;
  migrations: Migrations<Config>;
  configPath: string;
  validateLatestConfig: ValidateFunction<LatestConfig>;
  config: Config;
  validate: undefined | ConfigValidateFunction<LatestConfig>;
  latestConfigVersion: string | number;
};

const migrateConfig = async <
  Config extends BaseConfig,
  LatestConfig extends BaseConfig,
>({
  configString,
  migrations,
  configPath,
  validateLatestConfig,
  config,
  validate,
  latestConfigVersion,
}: MigrateConfigOptions<Config, LatestConfig>): Promise<{
  latestConfig: LatestConfig;
  configString: string;
}> => {
  let migratedConfig = config;

  for (const migration of migrations.slice(Number(config.version))) {
    // eslint-disable-next-line no-await-in-loop
    migratedConfig = await migration(migratedConfig);
  }

  const [{ parse }, { yamlDiffPatch }] = await Promise.all([
    import("yaml"),
    import("yaml-diff-patch"),
  ]);

  const migratedConfigString = yamlDiffPatch(
    configString,
    parse(configString),
    migratedConfig,
  );

  const latestConfig: unknown = parse(migratedConfigString);

  if (!validateLatestConfig(latestConfig)) {
    return commandObj.error(
      `Couldn't migrate config ${color.yellow(
        configPath,
      )}. ${await validationErrorToString(
        validateLatestConfig.errors,
        latestConfigVersion,
      )}`,
    );
  }

  const maybeValidationError =
    validate !== undefined && (await validate(latestConfig, configPath));

  if (typeof maybeValidationError === "string") {
    return commandObj.error(
      `Invalid config ${color.yellow(
        configPath,
      )} after successful migration. Config after migration looks like this:\n\n${migratedConfigString}\n\nErrors: ${maybeValidationError}`,
    );
  }

  if (configString !== migratedConfigString) {
    await saveConfig(configPath, migratedConfigString);
  }

  return {
    latestConfig,
    configString: migratedConfigString,
  };
};

type EnsureConfigOptions<
  Config extends BaseConfig,
  LatestConfig extends BaseConfig,
> = {
  configPath: string;
  validateLatestConfig: ValidateFunction<LatestConfig>;
  config: Config;
  validate: undefined | ConfigValidateFunction<LatestConfig>;
  latestConfigVersion: string | number;
};

const ensureConfigIsValidLatest = async <
  Config extends BaseConfig,
  LatestConfig extends BaseConfig,
>({
  configPath,
  validateLatestConfig,
  config,
  validate,
  latestConfigVersion,
}: EnsureConfigOptions<Config, LatestConfig>): Promise<LatestConfig> => {
  if (!validateLatestConfig(config)) {
    return commandObj.error(
      `Invalid config ${color.yellow(
        configPath,
      )}. ${await validationErrorToString(
        validateLatestConfig.errors,
        latestConfigVersion,
      )}`,
    );
  }

  const maybeValidationError =
    validate !== undefined && (await validate(config, configPath));

  if (typeof maybeValidationError === "string") {
    return commandObj.error(
      `Invalid config ${color.yellow(
        configPath,
      )}. Errors:\n${maybeValidationError}`,
    );
  }

  return config;
};

export type InitializedReadonlyConfig<LatestConfig> = Readonly<LatestConfig> & {
  $getPath(): string;
  $getDirPath(): string;
  $getConfigString(): string;
  $validateLatest: ValidateFunction<LatestConfig>;
};
export type InitializedConfig<LatestConfig> = Mutable<
  InitializedReadonlyConfig<LatestConfig>
> & {
  $commit(): Promise<void>;
};
type BaseConfig = { version: number | string } & Record<string, unknown>;
export type Migrations<Config> = Array<
  (config: Config) => Config | Promise<Config>
>;
export type GetDefaultConfig = () => string | Promise<string>;
type GetPath = () => string | Promise<string>;

export type ConfigValidateFunction<LatestConfig> = (
  config: LatestConfig,
  configPath: string,
) => ValidationResult | Promise<ValidationResult>;

export type InitConfigOptions<
  Config extends BaseConfig,
  LatestConfig extends BaseConfig,
> = {
  allSchemas: Array<JSONSchemaType<Config>>;
  latestSchema: JSONSchemaType<LatestConfig>;
  migrations: Migrations<Config>;
  name: string;
  getConfigOrConfigDirPath: GetPath;
  getSchemaDirPath?: GetPath;
  validate?: ConfigValidateFunction<LatestConfig>;
};

type InitFunction<LatestConfig> =
  () => Promise<InitializedConfig<LatestConfig> | null>;

type InitFunctionWithDefault<LatestConfig> = () => Promise<
  InitializedConfig<LatestConfig>
>;

type InitReadonlyFunction<LatestConfig> =
  () => Promise<InitializedReadonlyConfig<LatestConfig> | null>;

type InitReadonlyFunctionWithDefault<LatestConfig> = () => Promise<
  InitializedReadonlyConfig<LatestConfig>
>;

export const getConfigPath = (
  configOrConfigDirPath: string,
  configName: string,
) => {
  return configOrConfigDirPath.endsWith(YAML_EXT) ||
    configOrConfigDirPath.endsWith(YML_EXT)
    ? {
        configPath: configOrConfigDirPath,
        configDirPath: dirname(configOrConfigDirPath),
      }
    : {
        configPath: join(configOrConfigDirPath, configName),
        configDirPath: configOrConfigDirPath,
      };
};

export function getReadonlyConfigInitFunction<
  Config extends BaseConfig,
  LatestConfig extends BaseConfig,
>(
  options: InitConfigOptions<Config, LatestConfig>,
  getDefaultConfig?: undefined,
): InitReadonlyFunction<LatestConfig>;
export function getReadonlyConfigInitFunction<
  Config extends BaseConfig,
  LatestConfig extends BaseConfig,
>(
  options: InitConfigOptions<Config, LatestConfig>,
  getDefaultConfig?: GetDefaultConfig,
): InitReadonlyFunctionWithDefault<LatestConfig>;

export function getReadonlyConfigInitFunction<
  Config extends BaseConfig,
  LatestConfig extends BaseConfig,
>(
  options: InitConfigOptions<Config, LatestConfig>,
  getDefaultConfig?: GetDefaultConfig,
): InitReadonlyFunction<LatestConfig> {
  return async (): Promise<InitializedReadonlyConfig<LatestConfig> | null> => {
    const {
      allSchemas,
      latestSchema,
      migrations,
      name,
      getConfigOrConfigDirPath,
      validate,
      getSchemaDirPath,
    } = options;

    // every config schema must have a version, because LatestConfig extends BaseConfig
    // but ajv doesn't currently produce correct types for this unfortunately
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unsafe-member-access
    const latestConfigVersion = latestSchema.properties.version.const as
      | string
      | number;

    const configFullName = `${name}.${YAML_EXT}`;

    const getConfigPathResult = getConfigPath(
      await getConfigOrConfigDirPath(),
      configFullName,
    );

    const { configDirPath } = getConfigPathResult;
    let { configPath } = getConfigPathResult;

    const Ajv = (await import("ajv")).default;

    const validateAllConfigVersions = new Ajv.default({
      allowUnionTypes: true,
    }).compile<Config>({
      oneOf: allSchemas,
    });

    const validateLatestConfig = new Ajv.default({
      allowUnionTypes: true,
    }).compile<LatestConfig>(latestSchema);

    const schemaPathCommentStart = "# yaml-language-server: $schema=";

    const getSchemaPathComment = async (): Promise<string> => {
      return `${schemaPathCommentStart}${await ensureSchema({
        name,
        configDirPath,
        getSchemaDirPath,
        schema: validateLatestConfig.schema,
      })}`;
    };

    const [{ parse }, { yamlDiffPatch }] = await Promise.all([
      import("yaml"),
      import("yaml-diff-patch"),
    ]);

    let configString: string;

    try {
      let fileContent: string;

      // try reading config file
      // if it fails, try replacing .yaml with .yml and vice versa and read again
      // this way we can support both .yaml and .yml extensions interchangeably
      try {
        fileContent = await readFile(configPath, FS_OPTIONS);
      } catch (e) {
        const endsWithYaml = configPath.endsWith(`.${YAML_EXT}`);
        const endsWithYml = configPath.endsWith(`.${YML_EXT}`);

        if (!endsWithYaml && !endsWithYml && getDefaultConfig !== undefined) {
          throw e;
        }

        // try reading again by replacing .yaml with .yml or vice versa
        const newConfigPath = `${configPath.slice(
          0,
          -(endsWithYaml ? YAML_EXT : YML_EXT).length,
        )}${endsWithYaml ? YML_EXT : YAML_EXT}`;

        fileContent = await readFile(newConfigPath, FS_OPTIONS);
        configPath = newConfigPath;
      }

      // If config file exists, add schema path comment, if it's missing
      // or replace it if it's incorrect
      const schemaPathComment = await getSchemaPathComment();

      configString = fileContent.startsWith(schemaPathCommentStart)
        ? `${[schemaPathComment, ...fileContent.split("\n").slice(1)]
            .join("\n")
            .trim()}\n`
        : `${schemaPathComment}\n${fileContent.trim()}\n`;

      if (configString !== fileContent) {
        await saveConfig(configPath, configString);
      }
    } catch {
      if (getDefaultConfig === undefined) {
        // If config file doesn't exist and there is no default config, return null
        return null;
      }
      // If config file doesn't exist, create it with default config and schema path comment

      const documentationLinkComment = `# Documentation: https://github.com/fluencelabs/cli/tree/main/docs/configs/${name.replace(
        `.${YAML_EXT}`,
        "",
      )}.md`;

      const schemaPathComment = await getSchemaPathComment();

      const description =
        typeof latestSchema["description"] === "string"
          ? `\n\n# ${latestSchema["description"]}`
          : "";

      const defConf = await getDefaultConfig();

      configString =
        // this is basically the only place where userConfig is undefined until it's initialized in initCli
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
        userConfig?.docsInConfigs ?? false
          ? `${schemaPathComment}\n\n${documentationLinkComment}\n${defConf}`
          : yamlDiffPatch(
              `${schemaPathComment}\n${description}\n\n${documentationLinkComment}\n`,
              {},
              parse(defConf),
            );

      await saveConfig(configPath, configString);
    }

    const config: unknown = parse(configString);

    if (!validateAllConfigVersions(config)) {
      return commandObj.error(
        `Invalid config at ${color.yellow(
          configPath,
        )}. ${await validationErrorToString(
          validateAllConfigVersions.errors,
          latestConfigVersion,
        )}`,
      );
    }

    let latestConfig: LatestConfig;

    if (Number(config.version) < migrations.length) {
      ({ latestConfig, configString } = await migrateConfig({
        config,
        configPath,
        configString,
        migrations,
        validateLatestConfig,
        validate,
        latestConfigVersion,
      }));
    } else {
      latestConfig = await ensureConfigIsValidLatest({
        config,
        configPath,
        validateLatestConfig,
        validate,
        latestConfigVersion,
      });
    }

    return {
      ...latestConfig,
      $getPath(): string {
        return configPath;
      },
      $getDirPath(): string {
        return dirname(configPath);
      },
      $getConfigString(): string {
        return configString;
      },
      $validateLatest: validateLatestConfig,
    };
  };
}

const initializedConfigs = new Map<string, InitializedConfig<unknown>>();

function formatConfig(configString: string) {
  const formattedConfig = configString
    .trim()
    .split("\n")
    .flatMap((line, i, ar) => {
      // If it's an empty string - it was a newline before split - remove it
      if (line.trim() === "") {
        return [];
      }

      const maybePreviousLine = ar[i - 1];
      const isComment = line.startsWith("#");
      const isPreviousLineComment = maybePreviousLine?.startsWith("#") ?? false;

      const addNewLineBeforeBlockOfComments =
        isComment && !isPreviousLineComment;

      if (addNewLineBeforeBlockOfComments) {
        return ["", line];
      }

      const isFirstLine = maybePreviousLine === undefined;
      const isIndentedCode = line.startsWith(" ");

      const doNotAddNewLine =
        isFirstLine || isIndentedCode || isComment || isPreviousLineComment;

      if (doNotAddNewLine) {
        return [line];
      }

      // If it's top level property - separate it with a new line ("" -> "\n" when joined)
      return ["", line];
    })
    .join("\n");

  return `${formattedConfig.trim()}\n`;
}

async function saveConfig(
  configPath: string,
  migratedConfigString: string,
): Promise<string> {
  const configToSave = formatConfig(migratedConfigString);
  await writeFile(configPath, configToSave, FS_OPTIONS);
  return configToSave;
}

export function getConfigInitFunction<
  Config extends BaseConfig,
  LatestConfig extends BaseConfig,
>(
  options: InitConfigOptions<Config, LatestConfig>,
  getDefaultConfig?: never,
): InitFunction<LatestConfig>;
export function getConfigInitFunction<
  Config extends BaseConfig,
  LatestConfig extends BaseConfig,
>(
  options: InitConfigOptions<Config, LatestConfig>,
  getDefaultConfig: GetDefaultConfig,
): InitFunctionWithDefault<LatestConfig>;

export function getConfigInitFunction<
  Config extends BaseConfig,
  LatestConfig extends BaseConfig,
>(
  options: InitConfigOptions<Config, LatestConfig>,
  getDefaultConfig?: GetDefaultConfig,
): InitFunction<LatestConfig> {
  return async (): Promise<InitializedConfig<LatestConfig> | null> => {
    const configFullName = `${options.name}.${YAML_EXT}`;

    let { configPath } = getConfigPath(
      await options.getConfigOrConfigDirPath(),
      configFullName,
    );

    const previouslyInitializedConfig = initializedConfigs.get(configPath);

    if (previouslyInitializedConfig !== undefined) {
      // It's safe to assert here because we know that previouslyInitializedConfig has the same type
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      return previouslyInitializedConfig as InitializedConfig<LatestConfig>;
    }

    const initializedReadonlyConfig =
      getDefaultConfig === undefined
        ? await getReadonlyConfigInitFunction(options)()
        : await getReadonlyConfigInitFunction(options, getDefaultConfig)();

    if (initializedReadonlyConfig === null) {
      return null;
    }

    configPath = initializedReadonlyConfig.$getPath();
    let configString = initializedReadonlyConfig.$getConfigString();

    const config = {
      ...initializedReadonlyConfig,
      // have to type-cast `this` because TypeScript incorrectly thinks `this` can be a PromiseLike
      async $commit(this: InitializedConfig<LatestConfig>): Promise<void> {
        const config = removeProperties(this, ([, v]) => {
          return typeof v === "function";
        });

        const [{ parse }, { yamlDiffPatch }] = await Promise.all([
          import("yaml"),
          import("yaml-diff-patch"),
        ]);

        const newConfigString = `${yamlDiffPatch(
          configString,
          parse(configString),
          config,
        ).trim()}\n`;

        if (!initializedReadonlyConfig.$validateLatest(config)) {
          throw new Error(
            `Couldn't save config ${color.yellow(
              configPath,
            )}.\n\n${newConfigString}\n\n${await validationErrorToString(
              initializedReadonlyConfig.$validateLatest.errors,
              // every config schema has a version property by convention
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-unsafe-member-access
              options.latestSchema.properties.version.const as string,
            )}`,
          );
        }

        if (configString !== newConfigString) {
          configString = await saveConfig(configPath, newConfigString);
        }
      },
      $getConfigString(): string {
        return configString;
      },
    };

    initializedConfigs.set(configPath, config);
    return config;
  };
}
