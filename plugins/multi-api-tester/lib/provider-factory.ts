/**
 * Multi API Tester - Provider Factory
 * 
 * Creates Alma providers from site configurations.
 */

import type { SiteConfig, ApiFormat, ModelInfo } from './types';
import { fetchModels } from './model-fetcher';

// ============================================================================
// Types
// ============================================================================

export interface ProviderConfig {
    id: string;
    name: string;
    description: string;
    authType: 'apiKey';
    sdkType: 'openai' | 'anthropic';
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{ type: string; text?: string }>;
}

export interface ChatCompletionRequest {
    model: string;
    messages: ChatMessage[];
    stream?: boolean;
    maxTokens?: number;
    temperature?: number;
}

// ============================================================================
// Request Builders
// ============================================================================

function buildOpenAIChatBody(request: ChatCompletionRequest): string {
    return JSON.stringify({
        model: request.model,
        messages: request.messages,
        stream: request.stream ?? true,
        max_tokens: request.maxTokens,
        temperature: request.temperature,
    });
}

function buildAnthropicBody(request: ChatCompletionRequest): string {
    // Filter out system messages for Anthropic format
    const systemMessage = request.messages.find(m => m.role === 'system');
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system');

    return JSON.stringify({
        model: request.model,
        messages: nonSystemMessages.map(m => ({
            role: m.role,
            content: typeof m.content === 'string' ? m.content : m.content,
        })),
        system: systemMessage ? (typeof systemMessage.content === 'string' ? systemMessage.content : '') : undefined,
        stream: request.stream ?? true,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature,
    });
}

function buildResponsesBody(request: ChatCompletionRequest): string {
    // Convert messages to Responses API format
    const lastUserMessage = request.messages.filter(m => m.role === 'user').pop();
    const input = lastUserMessage 
        ? (typeof lastUserMessage.content === 'string' ? lastUserMessage.content : '')
        : '';

    return JSON.stringify({
        model: request.model,
        input,
        stream: request.stream ?? true,
        max_output_tokens: request.maxTokens,
        temperature: request.temperature,
    });
}

// ============================================================================
// Provider Factory
// ============================================================================

export function createProviderDefinition(site: SiteConfig, logger: { info: (msg: string) => void; error: (msg: string, e?: unknown) => void }) {
    const format = site.detectedFormat ?? 'openai-chat';
    const sdkType = format === 'anthropic' ? 'anthropic' : 'openai';

    // Determine endpoint based on format
    const getEndpoint = (f: ApiFormat): string => {
        switch (f) {
            case 'anthropic': return '/v1/messages';
            case 'openai-responses': return '/v1/responses';
            default: return '/v1/chat/completions';
        }
    };

    return {
        id: `multi-api-${site.id}`,
        name: site.name,
        description: `Custom API: ${site.baseUrl}`,
        authType: 'apiKey' as const,
        sdkType,

        async initialize() {
            logger.info(`Provider ${site.name} initialized`);
        },

        async isAuthenticated() {
            return !!site.apiKey;
        },

        async authenticate() {
            return { success: !!site.apiKey };
        },

        async logout() {
            // No-op for API key auth
        },

        async getModels(): Promise<Array<{ id: string; name: string }>> {
            const result = await fetchModels(site);
            if (!result.success) {
                logger.error(`Failed to fetch models from ${site.name}: ${result.error}`);
                return [];
            }
            return result.models.map(m => ({ id: m.id, name: m.name ?? m.id }));
        },

        async createChatCompletion(request: ChatCompletionRequest): Promise<ReadableStream | { content: string }> {
            const endpoint = getEndpoint(format);
            const url = `${site.baseUrl.replace(/\/$/, '')}${endpoint}`;

            const headers: Record<string, string> = {
                'Content-Type': 'application/json',
                ...site.customHeaders,
            };

            // Set auth header based on format
            if (format === 'anthropic') {
                headers['x-api-key'] = site.apiKey;
                headers['anthropic-version'] = '2023-06-01';
            } else {
                headers['Authorization'] = `Bearer ${site.apiKey}`;
            }

            // Build body based on format
            let body: string;
            switch (format) {
                case 'anthropic':
                    body = buildAnthropicBody(request);
                    break;
                case 'openai-responses':
                    body = buildResponsesBody(request);
                    break;
                default:
                    body = buildOpenAIChatBody(request);
            }

            const response = await fetch(url, { method: 'POST', headers, body });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`API error ${response.status}: ${errorText}`);
            }

            if (request.stream && response.body) {
                return response.body;
            }

            const data = await response.json();
            return { content: extractContent(data, format) };
        },

        async getSDKConfig() {
            return {
                apiKey: site.apiKey,
                baseURL: site.baseUrl,
            };
        },
    };
}

function extractContent(data: unknown, format: ApiFormat): string {
    const obj = data as Record<string, unknown>;
    if (format === 'anthropic') {
        const content = obj.content as Array<{ text?: string }> | undefined;
        return content?.[0]?.text ?? '';
    }
    const choices = obj.choices as Array<{ message?: { content?: string } }> | undefined;
    return choices?.[0]?.message?.content ?? '';
}

