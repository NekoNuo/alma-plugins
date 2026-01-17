/**
 * Multi API Tester - Model Fetcher
 */

import type { SiteConfig, ModelInfo, SiteModelsResult, ApiFormat } from './types';

// ============================================================================
// Model List Endpoints
// ============================================================================

const MODEL_ENDPOINTS: Record<Exclude<ApiFormat, 'unknown'>, string> = {
    'openai-chat': '/v1/models',
    'openai-responses': '/v1/models',
    'anthropic': '/v1/models',
};

// ============================================================================
// Model Fetching
// ============================================================================

/**
 * Fetch models from a site using the appropriate API format
 */
export async function fetchModels(
    site: SiteConfig,
    timeout = 10000
): Promise<SiteModelsResult> {
    const format = site.detectedFormat ?? 'openai-chat';
    if (format === 'unknown') {
        return {
            siteId: site.id,
            siteName: site.name,
            success: false,
            models: [],
            error: 'Unknown API format. Please test the site first.',
            fetchedAt: Date.now(),
        };
    }

    const endpoint = MODEL_ENDPOINTS[format];
    const url = `${site.baseUrl.replace(/\/$/, '')}${endpoint}`;

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...site.customHeaders,
    };

    // Set appropriate auth header
    if (format === 'anthropic') {
        headers['x-api-key'] = site.apiKey;
        headers['anthropic-version'] = '2023-06-01';
    } else {
        headers['Authorization'] = `Bearer ${site.apiKey}`;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const response = await fetch(url, {
            method: 'GET',
            headers,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            return {
                siteId: site.id,
                siteName: site.name,
                success: false,
                models: [],
                error: `HTTP ${response.status}: ${errorText}`,
                fetchedAt: Date.now(),
            };
        }

        const data = await response.json();
        const models = parseModelsResponse(data, format);

        return {
            siteId: site.id,
            siteName: site.name,
            success: true,
            models,
            fetchedAt: Date.now(),
        };
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
            siteId: site.id,
            siteName: site.name,
            success: false,
            models: [],
            error: errorMessage,
            fetchedAt: Date.now(),
        };
    }
}

/**
 * Parse models response based on API format
 */
function parseModelsResponse(data: unknown, _format: ApiFormat): ModelInfo[] {
    if (!data || typeof data !== 'object') {
        return [];
    }

    const response = data as Record<string, unknown>;

    // OpenAI format: { data: [...] }
    if (Array.isArray(response.data)) {
        return response.data.map((m: Record<string, unknown>) => ({
            id: String(m.id ?? ''),
            name: m.name ? String(m.name) : undefined,
            owned_by: m.owned_by ? String(m.owned_by) : undefined,
            created: typeof m.created === 'number' ? m.created : undefined,
            object: m.object ? String(m.object) : undefined,
        }));
    }

    // Anthropic format: { models: [...] } or direct array
    if (Array.isArray(response.models)) {
        return response.models.map((m: Record<string, unknown>) => ({
            id: String(m.id ?? m.name ?? ''),
            name: m.display_name ? String(m.display_name) : undefined,
        }));
    }

    // Direct array format
    if (Array.isArray(response)) {
        return response.map((m: Record<string, unknown>) => ({
            id: String(m.id ?? m.name ?? ''),
            name: m.name ? String(m.name) : undefined,
        }));
    }

    return [];
}

/**
 * Fetch models from all enabled sites
 */
export async function fetchAllModels(
    sites: SiteConfig[],
    timeout = 10000
): Promise<SiteModelsResult[]> {
    const enabledSites = sites.filter(s => s.enabled);
    return Promise.all(enabledSites.map(site => fetchModels(site, timeout)));
}

