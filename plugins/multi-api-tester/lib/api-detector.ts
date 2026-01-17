/**
 * Multi API Tester - API Format Detection
 */

import type {
    ApiFormat,
    FormatDetectionResult,
    SiteConfig,
    TestConfig,
    OpenAIChatRequest,
    AnthropicMessagesRequest,
    OpenAIResponsesRequest,
} from './types';
import { DEFAULT_TEST_CONFIG } from './types';

// ============================================================================
// API Endpoints
// ============================================================================

const ENDPOINTS = {
    'openai-chat': '/v1/chat/completions',
    'openai-responses': '/v1/responses',
    'anthropic': '/v1/messages',
} as const;

// ============================================================================
// Request Builders
// ============================================================================

function buildOpenAIChatRequest(config: TestConfig): OpenAIChatRequest {
    return {
        model: config.testModel,
        messages: [{ role: 'user', content: config.testPrompt }],
        max_tokens: config.maxTokens,
        stream: false,
    };
}

function buildAnthropicRequest(config: TestConfig): AnthropicMessagesRequest {
    return {
        model: config.testModel,
        messages: [{ role: 'user', content: config.testPrompt }],
        max_tokens: config.maxTokens,
        stream: false,
    };
}

function buildOpenAIResponsesRequest(config: TestConfig): OpenAIResponsesRequest {
    return {
        model: config.testModel,
        input: config.testPrompt,
        max_output_tokens: config.maxTokens,
        stream: false,
    };
}

// ============================================================================
// Format Detection
// ============================================================================

async function testEndpoint(
    site: SiteConfig,
    format: ApiFormat,
    config: TestConfig
): Promise<FormatDetectionResult> {
    if (format === 'unknown') {
        return { format, endpoint: '', success: false, latencyMs: 0, error: 'Unknown format' };
    }

    const endpoint = ENDPOINTS[format];
    const url = `${site.baseUrl.replace(/\/$/, '')}${endpoint}`;
    const startTime = Date.now();

    let body: string;
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...site.customHeaders,
    };

    // Set appropriate auth header based on format
    if (format === 'anthropic') {
        headers['x-api-key'] = site.apiKey;
        headers['anthropic-version'] = '2023-06-01';
        body = JSON.stringify(buildAnthropicRequest(config));
    } else {
        headers['Authorization'] = `Bearer ${site.apiKey}`;
        body = format === 'openai-responses'
            ? JSON.stringify(buildOpenAIResponsesRequest(config))
            : JSON.stringify(buildOpenAIChatRequest(config));
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.timeout);

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body,
            signal: controller.signal,
        });

        clearTimeout(timeoutId);
        const latencyMs = Date.now() - startTime;

        if (response.ok) {
            const data = await response.json();
            return { format, endpoint, success: true, latencyMs, response: data };
        }

        const errorText = await response.text();
        return { format, endpoint, success: false, latencyMs, error: `HTTP ${response.status}: ${errorText}` };
    } catch (error) {
        const latencyMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        return { format, endpoint, success: false, latencyMs, error: errorMessage };
    }
}

/**
 * Detect which API format a site supports
 */
export async function detectApiFormat(
    site: SiteConfig,
    config: Partial<TestConfig> = {}
): Promise<FormatDetectionResult[]> {
    const testConfig: TestConfig = { ...DEFAULT_TEST_CONFIG, ...config };
    const formats: Exclude<ApiFormat, 'unknown'>[] = ['openai-chat', 'anthropic', 'openai-responses'];
    
    const results = await Promise.all(
        formats.map(format => testEndpoint(site, format, testConfig))
    );

    return results;
}

/**
 * Detect the first working API format for a site
 */
export async function detectFirstWorkingFormat(
    site: SiteConfig,
    config: Partial<TestConfig> = {}
): Promise<FormatDetectionResult | null> {
    const results = await detectApiFormat(site, config);
    return results.find(r => r.success) ?? null;
}

