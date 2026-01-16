import type { PluginContext, PluginActivation, QuickPickItem } from 'alma-plugin-api';

/**
 * API Format Switcher Plugin
 *
 * Displays current API format in status bar and allows switching
 * between different formats (messages, chat/completions, responses).
 */

// Predefined API formats
const PREDEFINED_FORMATS = [
    { value: 'messages', label: 'messages', description: 'Anthropic /v1/messages' },
    { value: 'chat/completions', label: 'chat/completions', description: 'OpenAI Chat API' },
    { value: 'responses', label: 'responses', description: 'OpenAI Responses API' },
];

export async function activate(context: PluginContext): Promise<PluginActivation> {
    const { logger, commands, ui, settings } = context;

    logger.info('API Format Switcher plugin activated!');

    // Create status bar item
    const statusBarItem = ui.createStatusBarItem({
        id: 'api-format-switcher',
        alignment: 'right',
        priority: 90,
    });

    // Get settings
    const getSettings = () => ({
        current: settings.get<string>('apiFormat.current', 'messages'),
        customFormats: settings.get<string[]>('apiFormat.customFormats', []),
    });

    // Get all available formats (predefined + custom)
    const getAllFormats = (): QuickPickItem<string>[] => {
        const { customFormats } = getSettings();
        const formats: QuickPickItem<string>[] = PREDEFINED_FORMATS.map(f => ({
            label: f.label,
            description: f.description,
            value: f.value,
        }));

        // Add custom formats
        for (const format of customFormats) {
            formats.push({
                label: format,
                description: 'Custom format',
                value: format,
            });
        }

        return formats;
    };

    // Update status bar display
    const updateStatusBar = () => {
        const { current } = getSettings();
        statusBarItem.text = `API: ${current}`;
        statusBarItem.tooltip = `Current API Format: ${current}\nClick to switch`;
    };

    // Switch format command
    const switchDisposable = commands.register('apiFormat.switch', async () => {
        const formats = getAllFormats();
        const { current } = getSettings();

        // Mark current format
        const items = formats.map(f => ({
            ...f,
            description: f.value === current ? `${f.description || ''} ✓`.trim() : f.description,
        }));

        // Add option to add custom format
        items.push({
            label: '+ Add Custom Format...',
            description: 'Add a new custom API format',
            value: '__add_custom__',
        });

        const selected = await ui.showQuickPick(items, {
            title: 'Select API Format',
            placeholder: 'Choose an API format or add custom',
        });

        if (selected === '__add_custom__') {
            await commands.execute('apiFormat.addCustom');
        } else if (selected && selected !== current) {
            await settings.set('apiFormat.current', selected);
            updateStatusBar();
            ui.showNotification(`API format switched to: ${selected}`, { type: 'success' });
            logger.info(`API format changed to: ${selected}`);
        }
    });

    // Add custom format command
    const addCustomDisposable = commands.register('apiFormat.addCustom', async () => {
        const newFormat = await ui.showInputBox({
            title: 'Add Custom API Format',
            prompt: 'Enter the custom API format path',
            placeholder: 'e.g., /v2/chat or custom/endpoint',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Format cannot be empty';
                }
                const { customFormats } = getSettings();
                const allValues = [...PREDEFINED_FORMATS.map(f => f.value), ...customFormats];
                if (allValues.includes(value.trim())) {
                    return 'This format already exists';
                }
                return undefined;
            },
        });

        if (newFormat) {
            const { customFormats } = getSettings();
            const updated = [...customFormats, newFormat.trim()];
            await settings.set('apiFormat.customFormats', updated);
            await settings.set('apiFormat.current', newFormat.trim());
            updateStatusBar();
            ui.showNotification(`Custom format added: ${newFormat}`, { type: 'success' });
            logger.info(`Custom format added: ${newFormat}`);
        }
    });

    // Set status bar click command
    statusBarItem.command = 'apiFormat.switch';

    // Initialize
    updateStatusBar();
    statusBarItem.show();

    // Listen for settings changes
    const settingsDisposable = settings.onDidChange(() => {
        updateStatusBar();
    });

    return {
        dispose: () => {
            logger.info('API Format Switcher plugin deactivated');
            switchDisposable.dispose();
            addCustomDisposable.dispose();
            settingsDisposable.dispose();
            statusBarItem.dispose();
        },
    };
}

