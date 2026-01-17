/**
 * Multi API Tester Plugin
 * 
 * Test multiple AI API endpoints, detect API formats, and fetch available models.
 */

import type { PluginContext, PluginActivation } from 'alma-plugin-api';
import { createSiteStore, type SiteStore } from './lib/site-store';
import { detectApiFormat, detectFirstWorkingFormat } from './lib/api-detector';
import { fetchModels, fetchAllModels } from './lib/model-fetcher';
import type { SiteConfig, TestConfig, ApiFormat } from './lib/types';
import { DEFAULT_TEST_CONFIG } from './lib/types';

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
    const { logger, tools, commands, ui, storage, secrets, settings } = context;

    logger.info('Multi API Tester plugin activated');

    const siteStore = createSiteStore(storage, secrets);

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
    // Cleanup
    // =========================================================================
    return {
        dispose: () => {
            logger.info('Multi API Tester plugin deactivated');
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
        },
    };
}

