/**
 * Provider Format Display Plugin
 *
 * 在状态栏实时显示当前 Provider 和 API Format 信息
 * 支持切换时自动更新
 */

import type { PluginContext, PluginActivation, Provider } from 'alma-plugin-api';

// API Format 类型 (与 multi-api-tester 保持一致)
type ApiFormat = 'openai-chat' | 'openai-responses' | 'anthropic' | 'unknown';

// 设置中的站点配置
interface SettingsSiteConfig {
    name: string;
    baseUrl: string;
    apiKey: string;
    enabled?: boolean;
    format?: 'auto' | ApiFormat;
}

// Format 显示名称映射
const FORMAT_DISPLAY_NAMES: Record<ApiFormat | 'auto', string> = {
    'openai-chat': 'Chat Completions',
    'openai-responses': 'Responses API',
    'anthropic': 'Messages API',
    'unknown': 'Unknown',
    'auto': 'Auto',
};

// Format 端点路径映射
const FORMAT_ENDPOINTS: Record<ApiFormat, string> = {
    'openai-chat': '/v1/chat/completions',
    'openai-responses': '/v1/responses',
    'anthropic': '/v1/messages',
    'unknown': '',
};

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, events, ui, settings, providers } = context;

    logger.info('Provider Format Display plugin activated');

    // 创建状态栏项
    const statusBarItem = ui.createStatusBarItem({
        id: 'provider-format-display',
        alignment: 'right',
        priority: 90,
    });

    // 当前状态
    let currentProviderId: string | null = null;
    let currentProvider: Provider | null = null;
    let currentFormat: ApiFormat | 'auto' = 'unknown';

    // 获取设置
    const getDisplaySettings = () => ({
        showProvider: settings.get<boolean>('providerFormatDisplay.showProvider', true),
        showFormat: settings.get<boolean>('providerFormatDisplay.showFormat', true),
    });

    // 从 multi-api-tester 设置中获取站点的 API format
    const getSiteFormat = (providerName: string): ApiFormat | 'auto' => {
        const sites = settings.get<SettingsSiteConfig[]>('multi-api-tester.sites') ?? [];
        const site = sites.find(s => s.name === providerName);
        if (site?.format) {
            return site.format;
        }
        return 'unknown';
    };

    // 根据 providerId 获取 provider 信息
    const fetchProviderInfo = async (providerId: string): Promise<void> => {
        try {
            const provider = await providers.get(providerId);
            if (provider) {
                currentProvider = provider;
                currentFormat = getSiteFormat(provider.name);
                logger.debug(`Provider info: ${provider.name}, format: ${currentFormat}`);
            } else {
                // Provider 未找到，可能是内置 provider
                currentProvider = {
                    id: providerId,
                    name: providerId,
                    type: 'unknown',
                    enabled: true,
                };
                currentFormat = 'unknown';
            }
        } catch (error) {
            logger.error('Failed to fetch provider info:', error);
            currentProvider = null;
            currentFormat = 'unknown';
        }
    };

    // 更新状态栏显示
    const updateStatusBar = () => {
        const { showProvider, showFormat } = getDisplaySettings();

        if (!currentProvider) {
            statusBarItem.text = 'Provider: -';
            statusBarItem.tooltip = '等待选择 Provider';
            return;
        }

        const parts: string[] = [];
        const tooltipLines: string[] = [];

        // Provider 名称
        if (showProvider) {
            parts.push(currentProvider.name);
            tooltipLines.push(`Provider: ${currentProvider.name}`);
            tooltipLines.push(`ID: ${currentProvider.id}`);
        }

        // API Format
        if (showFormat) {
            const formatDisplay = FORMAT_DISPLAY_NAMES[currentFormat] || currentFormat;
            parts.push(`[${formatDisplay}]`);
            tooltipLines.push('');
            tooltipLines.push(`API Format: ${formatDisplay}`);
            if (currentFormat !== 'unknown' && currentFormat !== 'auto') {
                tooltipLines.push(`Endpoint: ${FORMAT_ENDPOINTS[currentFormat]}`);
            }
        }

        // 设置状态栏文本
        if (parts.length > 0) {
            statusBarItem.text = parts.join(' ');
        } else {
            statusBarItem.text = currentProvider.name;
        }

        // 设置 tooltip
        statusBarItem.tooltip = tooltipLines.join('\n');
    };

    // 监听消息接收事件，获取当前使用的 provider
    const messageDisposable = events.on('chat.message.didReceive', async (input, _output) => {
        const { providerId } = input;

        if (providerId && providerId !== currentProviderId) {
            currentProviderId = providerId;
            await fetchProviderInfo(providerId);
            updateStatusBar();
            logger.info(`Provider switched to: ${currentProvider?.name} (${currentFormat})`);
        }
    });

    // 监听线程激活事件
    const threadDisposable = events.on('thread.activated', async (input, _output) => {
        const { providerId } = input;

        if (providerId && providerId !== currentProviderId) {
            currentProviderId = providerId;
            await fetchProviderInfo(providerId);
            updateStatusBar();
            logger.info(`Thread activated with provider: ${currentProvider?.name} (${currentFormat})`);
        }
    });

    // 监听设置变化
    const settingsDisposable = settings.onDidChange(() => {
        // 重新获取 format 信息
        if (currentProvider) {
            currentFormat = getSiteFormat(currentProvider.name);
        }
        updateStatusBar();
        logger.debug('Settings changed, status bar updated');
    });

    // 初始化状态栏
    updateStatusBar();
    statusBarItem.show();

    return {
        dispose: () => {
            logger.info('Provider Format Display plugin deactivated');
            messageDisposable.dispose();
            threadDisposable.dispose();
            settingsDisposable.dispose();
            statusBarItem.dispose();
        },
    };
}
