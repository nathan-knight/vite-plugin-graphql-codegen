import { Plugin } from 'vite';
import { CodegenContext, generate, loadContext } from '@graphql-codegen/cli';
import { Types } from '@graphql-codegen/plugin-helpers';
import {
  isCodegenConfig,
  isGraphQLDocument,
  isGraphQLSchema,
} from './utils/fileMatchers';
import { ViteMode, isServeMode, isBuildMode } from './utils/viteModes';
import { debugLog } from './utils/debugLog';

export interface Options {
  /**
   * Run codegen on server start.
   * @defaultValue `true`
   */
  runOnStart?: boolean;
  /**
   * Run codegen on build. Will prevent build if codegen fails.
   * @defaultValue `true`
   */
  runOnBuild?: boolean;
  /**
   * Enable codegen integration with vite file watcher.
   * @defaultValue `true`
   */
  enableWatcher?: boolean;
  /**
   * Throw an error if codegen fails on server start.
   * @defaultValue `false`
   */
  throwOnStart?: boolean;
  /**
   * Throw an error if codegen fails on build.
   * @defaultValue `true`
   */
  throwOnBuild?: boolean;
  /**
   * Run codegen when a document matches.
   * @defaultValue `true`
   */
  matchOnDocuments?: boolean;
  /**
   * Run codegen when a schema matches. Only supports file path based schemas.
   * @defaultValue `false`
   */
  matchOnSchemas?: boolean;
  /**
   * Manually define the codegen config.
   */
  config?: Types.Config;
  /**
   * Override parts of the codegen config just for this plugin.
   */
  configOverride?: Partial<Types.Config>;
  /**
   * Override parts of the codegen config just for this plugin on server start.
   */
  configOverrideOnStart?: Partial<Types.Config>;
  /**
   * Override parts of the codegen config just for this plugin on build.
   */
  configOverrideOnBuild?: Partial<Types.Config>;
  /**
   * Override parts of the codegen config just for this plugin in the watcher.
   */
  configOverrideWatcher?: Partial<Types.Config>;
  /**
   * Override the codegen config file path.
   */
  configFilePathOverride?: string;
  /**
   * Log various steps to aid in tracking down bugs.
   * @defaultValue `false`
   */
  debug?: boolean;
}

export default function VitePluginGraphQLCodegen(options?: Options): Plugin {
  let codegenContext: CodegenContext;
  let viteMode: ViteMode;

  const {
    runOnStart = true,
    runOnBuild = true,
    enableWatcher = true,
    throwOnStart = false,
    throwOnBuild = true,
    matchOnDocuments = true,
    matchOnSchemas = false,
    config = null,
    configOverride = {},
    configOverrideOnStart = {},
    configOverrideOnBuild = {},
    configOverrideWatcher = {},
    configFilePathOverride,
    debug = false,
  } = options ?? {};

  const log = (...args: unknown[]) => {
    if (!debug) return;
    debugLog(...args);
  };

  const generateWithOverride = async (
    overrideConfig: Partial<Types.Config>,
  ) => {
    const currentConfig = codegenContext.getConfig();

    return generate({
      ...currentConfig,
      ...configOverride,
      ...overrideConfig,
      // Vite handles file watching
      watch: false,
    });
  };

  if (options) log('Plugin initialized with options:', options);

  return {
    name: 'graphql-codegen',
    async config(_config, env) {
      try {
        if (config) {
          log('Manual config passed, creating codegen context');
          codegenContext = new CodegenContext({ config });
        } else {
          const cwd = process.cwd();
          log('Loading codegen context:', configFilePathOverride ?? cwd);
          codegenContext = await loadContext(configFilePathOverride);
        }
        log('Loading codegen context successful');
      } catch (error) {
        log('Loading codegen context failed');
        throw error;
      }

      viteMode = env.command;
    },
    async buildStart() {
      if (isServeMode(viteMode)) {
        if (!runOnStart) return;

        try {
          await generateWithOverride(configOverrideOnStart);
          log('Generation successful on start');
        } catch (error) {
          // GraphQL Codegen handles logging useful errors
          log('Generation failed on start');
          if (throwOnStart) throw error;
        }
      }

      if (isBuildMode(viteMode)) {
        if (!runOnBuild) return;

        try {
          await generateWithOverride(configOverrideOnBuild);
          log('Generation successful on build');
        } catch (error) {
          // GraphQL Codegen handles logging useful errors
          log('Generation failed on build');
          if (throwOnBuild) throw error;
        }
      }
    },
    configureServer(server) {
      if (!enableWatcher) return;

      const listener = async (filePath = '') => {
        log('File changed:', filePath);

        const isConfig = isCodegenConfig(filePath, codegenContext);

        if (isConfig) {
          log('Codegen config file changed, restarting vite');
          server.restart();
          return;
        }

        if (matchOnDocuments) {
          try {
            const isDocument = await isGraphQLDocument(
              filePath,
              codegenContext,
            );
            log('Document check successful in file watcher');

            if (!isDocument && !matchOnSchemas) return;

            log('File matched a graphql document');
          } catch (error) {
            // GraphQL Codegen handles logging useful errors
            log('Document check failed in file watcher');
          }
        }

        if (matchOnSchemas) {
          try {
            const isSchema = await isGraphQLSchema(filePath, codegenContext);
            log('Schema check successful in file watcher');

            if (!isSchema) return;

            log('File matched a graphql schema');
          } catch (error) {
            // GraphQL Codegen handles logging useful errors
            log('Schema check failed in file watcher');
          }
        }

        try {
          await generateWithOverride(configOverrideWatcher);
          log('Generation successful in file watcher');
        } catch (error) {
          // GraphQL Codegen handles logging useful errors
          log('Generation failed in file watcher');
        }
      };

      server.watcher.on('add', listener);
      server.watcher.on('change', listener);
    },
  } as const satisfies Plugin;
}
