import type { PluginContext, PluginActivation, TokenUsage, ModelPricing } from 'alma-plugin-api';

/**
 * Prompt Capture Plugin
 *
 * 捕获并记录发送给 AI 的完整提示词，支持导出和历史查看功能
 */

// 捕获的提示词记录
interface CapturedPrompt {
    id: string;
    timestamp: string;
    threadId: string;
    model: string;
    providerId: string;
    content: string;
    response?: {
        content: string;
        usage?: TokenUsage;
        pricing?: ModelPricing;
    };
}

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, events, settings, commands, ui, storage } = context;

    logger.info('Prompt Capture plugin activated!');

    // 内存中的历史记录
    let capturedPrompts: CapturedPrompt[] = [];

    // 从存储中加载历史记录
    const loadHistory = async () => {
        try {
            const saved = await storage.local.get<CapturedPrompt[]>('capturedPrompts', []);
            capturedPrompts = saved;
            logger.debug(`Loaded ${capturedPrompts.length} prompts from storage`);
        } catch (error) {
            logger.error('Failed to load prompt history:', error);
        }
    };

    // 保存历史记录到存储
    const saveHistory = async () => {
        try {
            const maxHistory = settings.get<number>('promptCapture.maxHistory', 100);
            // 保留最新的记录
            if (capturedPrompts.length > maxHistory) {
                capturedPrompts = capturedPrompts.slice(-maxHistory);
            }
            await storage.local.set('capturedPrompts', capturedPrompts);
        } catch (error) {
            logger.error('Failed to save prompt history:', error);
        }
    };

    // 获取设置
    const getSettings = () => ({
        enabled: settings.get<boolean>('promptCapture.enabled', true),
        captureResponses: settings.get<boolean>('promptCapture.captureResponses', true),
        maxHistory: settings.get<number>('promptCapture.maxHistory', 100),
        logToConsole: settings.get<boolean>('promptCapture.logToConsole', true),
    });

    // 生成唯一 ID
    const generateId = () => `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

    // 格式化提示词用于显示
    const formatPromptForDisplay = (prompt: CapturedPrompt): string => {
        const lines: string[] = [
            '═'.repeat(60),
            `📝 Prompt Captured`,
            '─'.repeat(60),
            `🕐 Time: ${prompt.timestamp}`,
            `🆔 Thread: ${prompt.threadId}`,
            `🤖 Model: ${prompt.model}`,
            `🏢 Provider: ${prompt.providerId}`,
            '─'.repeat(60),
            '📄 Content:',
            prompt.content,
        ];

        if (prompt.response) {
            lines.push('─'.repeat(60));
            lines.push('💬 Response:');
            lines.push(prompt.response.content);

            if (prompt.response.usage) {
                lines.push('─'.repeat(60));
                lines.push('📊 Token Usage:');
                lines.push(`   Prompt: ${prompt.response.usage.promptTokens}`);
                lines.push(`   Completion: ${prompt.response.usage.completionTokens}`);
                lines.push(`   Total: ${prompt.response.usage.totalTokens}`);
                if (prompt.response.usage.cachedInputTokens) {
                    lines.push(`   Cached: ${prompt.response.usage.cachedInputTokens}`);
                }
            }
        }

        lines.push('═'.repeat(60));
        return lines.join('\n');
    };

    // 加载历史记录
    await loadHistory();

    // 订阅消息发送事件 - 捕获提示词
    const willSendDisposable = events.on(
        'chat.message.willSend',
        (input, _output) => {
            const config = getSettings();

            if (!config.enabled) {
                return;
            }

            const captured: CapturedPrompt = {
                id: generateId(),
                timestamp: new Date().toISOString(),
                threadId: input.threadId,
                model: input.model,
                providerId: input.providerId,
                content: input.content,
            };

            capturedPrompts.push(captured);

            if (config.logToConsole) {
                logger.info('=== CAPTURED PROMPT ===');
                logger.info(`Thread: ${input.threadId}`);
                logger.info(`Model: ${input.model}`);
                logger.info(`Provider: ${input.providerId}`);
                logger.info(`Content:\n${input.content}`);
                logger.info('========================');

                // 也输出到 console 以便在开发工具中查看
                console.log('\n' + formatPromptForDisplay(captured));
            }

            // 异步保存
            saveHistory();
        },
        { priority: 100 } // 高优先级，最先执行
    );

    // 订阅消息接收事件 - 捕获响应
    const didReceiveDisposable = events.on(
        'chat.message.didReceive',
        (input, _output) => {
            const config = getSettings();

            if (!config.enabled || !config.captureResponses) {
                return;
            }

            // 找到对应的提示词记录并更新响应
            const lastPrompt = capturedPrompts
                .filter((p) => p.threadId === input.threadId && !p.response)
                .pop();

            if (lastPrompt) {
                lastPrompt.response = {
                    content: input.response.content,
                    usage: input.response.usage,
                    pricing: input.pricing,
                };

                if (config.logToConsole) {
                    logger.info('=== CAPTURED RESPONSE ===');
                    logger.info(`Thread: ${input.threadId}`);
                    logger.info(`Model: ${input.model}`);
                    logger.info(`Response:\n${input.response.content}`);
                    if (input.response.usage) {
                        logger.info(`Tokens: ${JSON.stringify(input.response.usage)}`);
                    }
                    logger.info('=========================');
                }

                // 异步保存
                saveHistory();
            }
        },
        { priority: 100 }
    );

    // 命令：切换捕获状态
    const toggleDisposable = commands.register('promptCapture.toggle', async () => {
        const current = settings.get<boolean>('promptCapture.enabled', true);
        await settings.update('promptCapture.enabled', !current);

        const status = !current ? 'enabled' : 'disabled';
        ui.showNotification(`Prompt capture ${status}`, { type: 'info' });
    });

    // 命令：显示历史记录
    const showHistoryDisposable = commands.register('promptCapture.showHistory', async () => {
        if (capturedPrompts.length === 0) {
            ui.showNotification('No captured prompts yet', { type: 'info' });
            return;
        }

        const items = capturedPrompts.slice(-20).reverse().map((p, index) => ({
            label: `${index + 1}. ${p.content.substring(0, 50)}...`,
            description: `${p.model} | ${new Date(p.timestamp).toLocaleString()}`,
            detail: p.response ? `Response: ${p.response.content.substring(0, 100)}...` : 'No response yet',
            value: p.id,
        }));

        const selected = await ui.showQuickPick(items, {
            title: 'Captured Prompts',
            placeholder: 'Select a prompt to view details',
        });

        if (selected) {
            const prompt = capturedPrompts.find((p) => p.id === selected);
            if (prompt) {
                console.log(formatPromptForDisplay(prompt));
                ui.showNotification('Prompt details logged to console', { type: 'info' });
            }
        }
    });

    // 命令：清除历史记录
    const clearHistoryDisposable = commands.register('promptCapture.clearHistory', async () => {
        const confirmed = await ui.showConfirmDialog('Clear all captured prompts?', {
            type: 'warning',
            confirmLabel: 'Clear',
            cancelLabel: 'Cancel',
        });

        if (confirmed) {
            capturedPrompts = [];
            await storage.local.delete('capturedPrompts');
            ui.showNotification('Prompt history cleared', { type: 'success' });
        }
    });

    // 命令：导出历史记录
    const exportHistoryDisposable = commands.register('promptCapture.exportHistory', async () => {
        if (capturedPrompts.length === 0) {
            ui.showNotification('No prompts to export', { type: 'info' });
            return;
        }

        // 格式化导出内容
        const exportData = {
            exportedAt: new Date().toISOString(),
            totalPrompts: capturedPrompts.length,
            prompts: capturedPrompts,
        };

        const jsonContent = JSON.stringify(exportData, null, 2);

        // 输出到控制台
        console.log('\n=== EXPORTED PROMPTS (JSON) ===');
        console.log(jsonContent);
        console.log('=== END OF EXPORT ===\n');

        // 也输出可读格式
        console.log('\n=== EXPORTED PROMPTS (READABLE) ===');
        capturedPrompts.forEach((p, i) => {
            console.log(`\n--- Prompt ${i + 1} ---`);
            console.log(formatPromptForDisplay(p));
        });
        console.log('=== END OF EXPORT ===\n');

        ui.showNotification(`Exported ${capturedPrompts.length} prompts to console`, {
            type: 'success',
        });
    });

    return {
        dispose: () => {
            logger.info('Prompt Capture plugin deactivated');
            willSendDisposable.dispose();
            didReceiveDisposable.dispose();
            toggleDisposable.dispose();
            showHistoryDisposable.dispose();
            clearHistoryDisposable.dispose();
            exportHistoryDisposable.dispose();
        },
    };
}
