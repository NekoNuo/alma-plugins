/**
 * Multi API Tester Plugin
 *
 * Test multiple AI API endpoints, detect API formats, and register them as providers.
 */

import type { PluginContext, PluginActivation, Disposable } from 'alma-plugin-api';
import { createSiteStore } from './lib/site-store';
import { detectApiFormat, detectFirstWorkingFormat } from './lib/api-detector';
import { fetchModels, fetchAllModels } from './lib/model-fetcher';
import { createProviderDefinition } from './lib/provider-factory';
import type { SiteConfig, TestConfig, ApiFormat } from './lib/types';
import { DEFAULT_TEST_CONFIG } from './lib/types';

// ============================================================================
// Settings Site Config (from manifest configuration)
// ============================================================================

interface SettingsSiteConfig {
    name: string;
    baseUrl: string;
    apiKey: string;
    enabled?: boolean;
    format?: 'auto' | ApiFormat;
}

// ============================================================================
// Parameter Schemas
// ============================================================================

const addSiteSchema = {
    type: 'object',
    properties: {
        name: { type: 'string', description: 'Display name for the site' },
        baseUrl: { type: 'string', description: 'Base URL of the API (e.g., https://api.openai.com)' },
        apiKey: { type: 'string', description: 'API key for authentication' },
        customHeaders: { type: 'object', description: 'Optional custom headers' },
    },
    required: ['name', 'baseUrl', 'apiKey'],
} as const;

const siteIdSchema = {
    type: 'object',
    properties: {
        siteId: { type: 'string', description: 'The site ID to operate on' },
    },
    required: ['siteId'],
} as const;

const testSiteSchema = {
    type: 'object',
    properties: {
        siteId: { type: 'string', description: 'The site ID to test' },
        testModel: { type: 'string', description: 'Model to use for testing' },
        testPrompt: { type: 'string', description: 'Prompt to use for testing' },
    },
    required: ['siteId'],
} as const;

// ============================================================================
// Plugin Activation
// ============================================================================

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, tools, commands, ui, storage, settings, providers } = context;

    logger.info('Multi API Tester plugin activated');

    // Use storage.local for site configs and storage.secrets for API keys
    const siteStore = createSiteStore(storage.local, storage.secrets);
    const providerDisposables: Disposable[] = [];

    // =========================================================================
    // Load sites from settings and sync to store
    // =========================================================================
    async function syncSitesFromSettings(): Promise<void> {
        const settingsSites = await settings.get<SettingsSiteConfig[]>('multi-api-tester.sites') ?? [];

        for (const settingSite of settingsSites) {
            // Check if site already exists by name
            const existingSites = await siteStore.getAll();
            const existing = existingSites.find(s => s.name === settingSite.name);

            if (!existing) {
                // Add new site from settings
                const format = settingSite.format === 'auto' ? undefined : settingSite.format;
                await siteStore.add({
                    name: settingSite.name,
                    baseUrl: settingSite.baseUrl,
                    apiKey: settingSite.apiKey,
                    enabled: settingSite.enabled ?? true,
                    detectedFormat: format as ApiFormat | undefined,
                });
                logger.info(`Loaded site from settings: ${settingSite.name}`);
            }
        }
    }

    // =========================================================================
    // Register sites as providers
    // =========================================================================
    async function registerProviders(): Promise<void> {
        // Dispose existing providers
        for (const disposable of providerDisposables) {
            disposable.dispose();
        }
        providerDisposables.length = 0;

        const sites = await siteStore.getAll();
        const enabledSites = sites.filter(s => s.enabled);

        for (const site of enabledSites) {
            try {
                const providerDef = createProviderDefinition(site, logger);
                const disposable = providers.register(providerDef);
                providerDisposables.push(disposable);
                logger.info(`Registered provider: ${site.name}`);
            } catch (error) {
                logger.error(`Failed to register provider ${site.name}:`, error);
            }
        }

        ui.showNotification(`Registered ${providerDisposables.length} API providers`, { type: 'success' });
    }

    // =========================================================================
    // Initial setup
    // =========================================================================
    await syncSitesFromSettings();

    const autoRegister = await settings.get<boolean>('multi-api-tester.autoRegisterProviders') ?? true;
    if (autoRegister) {
        await registerProviders();
    }

    // =========================================================================
    // Tool: List Sites
    // =========================================================================
    const listSitesTool = tools.register('listSites', {
        description: 'List all configured API sites',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
            const sites = await siteStore.getAllInfo();
            return { success: true, sites, count: sites.length };
        },
    });

    // =========================================================================
    // Tool: Test Site
    // =========================================================================
    const testSiteTool = tools.register('testSite', {
        description: 'Test a specific API site and detect its supported formats',
        parameters: testSiteSchema,
        execute: async (params) => {
            const { siteId, testModel, testPrompt } = params as {
                siteId: string;
                testModel?: string;
                testPrompt?: string;
            };

            const site = await siteStore.get(siteId);
            if (!site) {
                return { success: false, error: `Site not found: ${siteId}` };
            }

            const testConfig: Partial<TestConfig> = {};
            if (testModel) testConfig.testModel = testModel;
            if (testPrompt) testConfig.testPrompt = testPrompt;

            const timeout = await settings.get<number>('multi-api-tester.timeout') ?? DEFAULT_TEST_CONFIG.timeout;
            testConfig.timeout = timeout;

            logger.info(`Testing site: ${site.name} (${site.baseUrl})`);
            const results = await detectApiFormat(site, testConfig);

            // Update detected format if successful
            const firstSuccess = results.find(r => r.success);
            if (firstSuccess) {
                await siteStore.setDetectedFormat(siteId, firstSuccess.format);
            }

            return { success: true, siteId, siteName: site.name, results };
        },
    });

    // =========================================================================
    // Tool: Get Models
    // =========================================================================
    const getModelsTool = tools.register('getModels', {
        description: 'Get available models from a site',
        parameters: siteIdSchema,
        execute: async (params) => {
            const { siteId } = params as { siteId: string };

            const site = await siteStore.get(siteId);
            if (!site) {
                return { success: false, error: `Site not found: ${siteId}` };
            }

            const timeout = await settings.get<number>('multi-api-tester.timeout') ?? DEFAULT_TEST_CONFIG.timeout;
            logger.info(`Fetching models from: ${site.name}`);
            
            const result = await fetchModels(site, timeout);
            return result;
        },
    });

    // =========================================================================
    // Command: Add Site
    // =========================================================================
    const addSiteCmd = commands.register('addSite', async () => {
        ui.showNotification('Use the AI tool "addSite" to add a new API site', { type: 'info' });
    });

    // Tool for adding sites (used by AI)
    const addSiteTool = tools.register('addSite', {
        description: 'Add a new API site configuration',
        parameters: addSiteSchema,
        execute: async (params) => {
            const { name, baseUrl, apiKey, customHeaders } = params as {
                name: string;
                baseUrl: string;
                apiKey: string;
                customHeaders?: Record<string, string>;
            };

            const site = await siteStore.add({
                name,
                baseUrl,
                apiKey,
                enabled: true,
                customHeaders,
            });

            logger.info(`Added site: ${name} (${site.id})`);
            ui.showNotification(`Added API site: ${name}`, { type: 'success' });
            return { success: true, site: { id: site.id, name: site.name, baseUrl: site.baseUrl } };
        },
    });

    // =========================================================================
    // Tool: Remove Site
    // =========================================================================
    const removeSiteTool = tools.register('removeSite', {
        description: 'Remove an API site configuration',
        parameters: siteIdSchema,
        execute: async (params) => {
            const { siteId } = params as { siteId: string };
            const site = await siteStore.get(siteId);
            if (!site) {
                return { success: false, error: `Site not found: ${siteId}` };
            }

            await siteStore.remove(siteId);
            logger.info(`Removed site: ${site.name}`);
            ui.showNotification(`Removed API site: ${site.name}`, { type: 'info' });
            return { success: true, removedSite: site.name };
        },
    });

    // =========================================================================
    // Command: Remove Site
    // =========================================================================
    const removeSiteCmd = commands.register('removeSite', async () => {
        ui.showNotification('Use the AI tool "removeSite" with a siteId to remove a site', { type: 'info' });
    });

    // =========================================================================
    // Command: Test All Sites
    // =========================================================================
    const testAllSitesCmd = commands.register('testAllSites', async () => {
        const sites = await siteStore.getAll();
        if (sites.length === 0) {
            ui.showNotification('No sites configured. Add sites first.', { type: 'warning' });
            return;
        }

        ui.showNotification(`Testing ${sites.length} sites...`, { type: 'info' });
        const timeout = await settings.get<number>('multi-api-tester.timeout') ?? DEFAULT_TEST_CONFIG.timeout;

        for (const site of sites.filter(s => s.enabled)) {
            const result = await detectFirstWorkingFormat(site, { timeout });
            if (result?.success) {
                await siteStore.setDetectedFormat(site.id, result.format);
                logger.info(`${site.name}: ${result.format} (${result.latencyMs}ms)`);
            } else {
                logger.warn(`${site.name}: No working format detected`);
            }
        }

        ui.showNotification('Site testing complete!', { type: 'success' });
    });

    // =========================================================================
    // Command: Fetch All Models
    // =========================================================================
    const fetchAllModelsCmd = commands.register('fetchAllModels', async () => {
        const sites = await siteStore.getAll();
        if (sites.length === 0) {
            ui.showNotification('No sites configured. Add sites first.', { type: 'warning' });
            return;
        }

        ui.showNotification(`Fetching models from ${sites.length} sites...`, { type: 'info' });
        const timeout = await settings.get<number>('multi-api-tester.timeout') ?? DEFAULT_TEST_CONFIG.timeout;

        const results = await fetchAllModels(sites, timeout);
        const totalModels = results.reduce((sum, r) => sum + r.models.length, 0);

        for (const result of results) {
            if (result.success) {
                logger.info(`${result.siteName}: ${result.models.length} models`);
            } else {
                logger.warn(`${result.siteName}: ${result.error}`);
            }
        }

        ui.showNotification(`Found ${totalModels} models across ${results.filter(r => r.success).length} sites`, { type: 'success' });
    });

    // =========================================================================
    // Tool: Fetch All Site Models
    // =========================================================================
    const fetchAllModelsTool = tools.register('fetchAllSiteModels', {
        description: 'Fetch models from all configured and enabled sites',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
            const sites = await siteStore.getAll();
            const timeout = await settings.get<number>('multi-api-tester.timeout') ?? DEFAULT_TEST_CONFIG.timeout;
            const results = await fetchAllModels(sites, timeout);
            return { success: true, results };
        },
    });

    // =========================================================================
    // Tool: Update Site
    // =========================================================================
    const updateSiteTool = tools.register('updateSite', {
        description: 'Update an existing site configuration',
        parameters: {
            type: 'object',
            properties: {
                siteId: { type: 'string', description: 'The site ID to update' },
                name: { type: 'string', description: 'New display name' },
                baseUrl: { type: 'string', description: 'New base URL' },
                apiKey: { type: 'string', description: 'New API key' },
                enabled: { type: 'boolean', description: 'Enable or disable the site' },
                customHeaders: { type: 'object', description: 'New custom headers' },
            },
            required: ['siteId'],
        },
        execute: async (params) => {
            const { siteId, ...updates } = params as { siteId: string } & Partial<SiteConfig>;
            const updated = await siteStore.update(siteId, updates);
            if (!updated) {
                return { success: false, error: `Site not found: ${siteId}` };
            }
            return { success: true, site: { id: updated.id, name: updated.name, baseUrl: updated.baseUrl } };
        },
    });

    // =========================================================================
    // Command: Register Providers
    // =========================================================================
    const registerProvidersCmd = commands.register('registerProviders', async () => {
        await registerProviders();
    });

    // =========================================================================
    // Tool: Register Providers
    // =========================================================================
    const registerProvidersTool = tools.register('registerProviders', {
        description: 'Register all enabled sites as AI providers',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
            await registerProviders();
            const sites = await siteStore.getAll();
            const enabledCount = sites.filter(s => s.enabled).length;
            return { success: true, registeredCount: enabledCount };
        },
    });

    // =========================================================================
    // Listen for settings changes
    // =========================================================================
    const settingsDisposable = settings.onDidChange(async () => {
        await syncSitesFromSettings();
        const autoRegister = await settings.get<boolean>('multi-api-tester.autoRegisterProviders') ?? true;
        if (autoRegister) {
            await registerProviders();
        }
    });

    // =========================================================================
    // Cleanup
    // =========================================================================
    return {
        dispose: () => {
            logger.info('Multi API Tester plugin deactivated');
            // Dispose providers
            for (const disposable of providerDisposables) {
                disposable.dispose();
            }
            settingsDisposable.dispose();
            listSitesTool.dispose();
            testSiteTool.dispose();
            getModelsTool.dispose();
            addSiteCmd.dispose();
            addSiteTool.dispose();
            removeSiteTool.dispose();
            removeSiteCmd.dispose();
            testAllSitesCmd.dispose();
            fetchAllModelsCmd.dispose();
            fetchAllModelsTool.dispose();
            updateSiteTool.dispose();
            registerProvidersCmd.dispose();
            registerProvidersTool.dispose();
        },
    };
}

