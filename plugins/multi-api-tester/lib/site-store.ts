/**
 * Multi API Tester - Site Configuration Store
 */

import type { SiteConfig, SiteInfo, ApiFormat } from './types';
import { STORAGE_KEYS } from './types';

// ============================================================================
// Site Store Interface
// ============================================================================

export interface SiteStore {
    getAll(): Promise<SiteConfig[]>;
    getAllInfo(): Promise<SiteInfo[]>;
    get(id: string): Promise<SiteConfig | undefined>;
    add(config: Omit<SiteConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<SiteConfig>;
    update(id: string, updates: Partial<Omit<SiteConfig, 'id' | 'createdAt'>>): Promise<SiteConfig | undefined>;
    remove(id: string): Promise<boolean>;
    setDetectedFormat(id: string, format: ApiFormat): Promise<void>;
}

// ============================================================================
// Storage Interface (provided by Alma plugin API)
// ============================================================================

interface StorageAPI {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
}

interface SecretsAPI {
    get(key: string): Promise<string | undefined>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
}

// ============================================================================
// Site Store Implementation
// ============================================================================

export function createSiteStore(storage: StorageAPI, secrets: SecretsAPI): SiteStore {
    const generateId = () => `site-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    async function getSitesMap(): Promise<Map<string, Omit<SiteConfig, 'apiKey'>>> {
        const data = await storage.get<Record<string, Omit<SiteConfig, 'apiKey'>>>(STORAGE_KEYS.SITES);
        return new Map(Object.entries(data ?? {}));
    }

    async function saveSitesMap(map: Map<string, Omit<SiteConfig, 'apiKey'>>): Promise<void> {
        await storage.set(STORAGE_KEYS.SITES, Object.fromEntries(map));
    }

    return {
        async getAll(): Promise<SiteConfig[]> {
            const sitesMap = await getSitesMap();
            const sites: SiteConfig[] = [];

            for (const [id, site] of sitesMap) {
                const apiKey = await secrets.get(`site-apikey-${id}`) ?? '';
                sites.push({ ...site, apiKey } as SiteConfig);
            }

            return sites;
        },

        async getAllInfo(): Promise<SiteInfo[]> {
            const sitesMap = await getSitesMap();
            return Array.from(sitesMap.values()).map(site => ({
                id: site.id,
                name: site.name,
                baseUrl: site.baseUrl,
                enabled: site.enabled,
                detectedFormat: site.detectedFormat,
            }));
        },

        async get(id: string): Promise<SiteConfig | undefined> {
            const sitesMap = await getSitesMap();
            const site = sitesMap.get(id);
            if (!site) return undefined;

            const apiKey = await secrets.get(`site-apikey-${id}`) ?? '';
            return { ...site, apiKey } as SiteConfig;
        },

        async add(config): Promise<SiteConfig> {
            const id = generateId();
            const now = Date.now();
            const newSite: SiteConfig = {
                ...config,
                id,
                createdAt: now,
                updatedAt: now,
            };

            // Store API key separately in secrets
            await secrets.set(`site-apikey-${id}`, newSite.apiKey);

            // Store site config without API key
            const sitesMap = await getSitesMap();
            const { apiKey, ...siteWithoutKey } = newSite;
            sitesMap.set(id, siteWithoutKey);
            await saveSitesMap(sitesMap);

            return newSite;
        },

        async update(id, updates): Promise<SiteConfig | undefined> {
            const sitesMap = await getSitesMap();
            const existing = sitesMap.get(id);
            if (!existing) return undefined;

            const { apiKey, ...restUpdates } = updates as Partial<SiteConfig>;
            
            // Update API key if provided
            if (apiKey !== undefined) {
                await secrets.set(`site-apikey-${id}`, apiKey);
            }

            // Update site config
            const updated = { ...existing, ...restUpdates, updatedAt: Date.now() };
            sitesMap.set(id, updated);
            await saveSitesMap(sitesMap);

            const currentApiKey = await secrets.get(`site-apikey-${id}`) ?? '';
            return { ...updated, apiKey: currentApiKey } as SiteConfig;
        },

        async remove(id: string): Promise<boolean> {
            const sitesMap = await getSitesMap();
            if (!sitesMap.has(id)) return false;

            sitesMap.delete(id);
            await saveSitesMap(sitesMap);
            await secrets.delete(`site-apikey-${id}`);
            return true;
        },

        async setDetectedFormat(id: string, format: ApiFormat): Promise<void> {
            await this.update(id, { detectedFormat: format });
        },
    };
}

