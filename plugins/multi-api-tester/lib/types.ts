/**
 * Multi API Tester - Type Definitions
 */

// ============================================================================
// API Format Types
// ============================================================================

/**
 * Supported API formats
 */
export type ApiFormat = 
    | 'openai-chat'        // /v1/chat/completions (OpenAI compatible)
    | 'openai-responses'   // /v1/responses (OpenAI Responses API)
    | 'anthropic'          // /v1/messages (Anthropic Claude)
    | 'unknown';

/**
 * API format detection result
 */
export interface FormatDetectionResult {
    format: ApiFormat;
    endpoint: string;
    success: boolean;
    latencyMs: number;
    error?: string;
    response?: unknown;
}

// ============================================================================
// Site Configuration Types
// ============================================================================

/**
 * API site configuration
 */
export interface SiteConfig {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    enabled: boolean;
    detectedFormat?: ApiFormat;
    customHeaders?: Record<string, string>;
    createdAt: number;
    updatedAt: number;
}

/**
 * Site configuration without sensitive data (for display)
 */
export interface SiteInfo {
    id: string;
    name: string;
    baseUrl: string;
    enabled: boolean;
    detectedFormat?: ApiFormat;
    modelCount?: number;
}

// ============================================================================
// Model Types
// ============================================================================

/**
 * Model information from API
 */
export interface ModelInfo {
    id: string;
    name?: string;
    owned_by?: string;
    created?: number;
    object?: string;
}

/**
 * Site models result
 */
export interface SiteModelsResult {
    siteId: string;
    siteName: string;
    success: boolean;
    models: ModelInfo[];
    error?: string;
    fetchedAt: number;
}

// ============================================================================
// Test Configuration Types
// ============================================================================

/**
 * Test configuration for API format detection
 */
export interface TestConfig {
    timeout: number;
    testModel: string;
    testPrompt: string;
    maxTokens: number;
}

/**
 * Default test configuration
 */
export const DEFAULT_TEST_CONFIG: TestConfig = {
    timeout: 10000,
    testModel: 'gpt-3.5-turbo',
    testPrompt: 'Say "Hello" in one word.',
    maxTokens: 10,
};

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * OpenAI Chat Completion request format
 */
export interface OpenAIChatRequest {
    model: string;
    messages: Array<{
        role: 'system' | 'user' | 'assistant';
        content: string;
    }>;
    max_tokens?: number;
    stream?: boolean;
}

/**
 * Anthropic Messages request format
 */
export interface AnthropicMessagesRequest {
    model: string;
    messages: Array<{
        role: 'user' | 'assistant';
        content: string;
    }>;
    max_tokens: number;
    stream?: boolean;
}

/**
 * OpenAI Responses API request format
 */
export interface OpenAIResponsesRequest {
    model: string;
    input: string | Array<{ type: string; text?: string }>;
    max_output_tokens?: number;
    stream?: boolean;
}

// ============================================================================
// Storage Keys
// ============================================================================

export const STORAGE_KEYS = {
    SITES: 'multi-api-tester.sites',
    MODELS_CACHE: 'multi-api-tester.modelsCache',
} as const;

