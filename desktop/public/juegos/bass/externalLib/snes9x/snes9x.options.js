export const DEFAULT_SNES9X_OPTIONS = {
    region: 'auto',
    interpolation: 'gaussian',
    renderFilter: 'pixelated',
    cropOverscan: true,
    aspect: '4:3',
    multitap: false,
    maxSpriteTilesPerLine: 34,
    superFXClockMultiplier: 100,
    volume: 1.0,
    gamepads: true,
    logLevel: 'error',
    escMenu: true,
};
/** Numeric ids consumed by s9xwasm_setup() in scripts/shim/s9x_shim.cpp. */
export const SNES9X_REGION_IDS = {
    auto: 0,
    ntsc: 1,
    pal: 2,
};
/** Numeric ids matching DSP_INTERPOLATION_* in apu/apu.h. */
export const SNES9X_INTERPOLATION_IDS = {
    none: 0,
    linear: 1,
    gaussian: 2,
    cubic: 3,
    sinc: 4,
};
export const SNES9X_LOG_LEVEL_IDS = {
    off: 0,
    error: 1,
    debug: 2,
};
export const SNES9X_OPTION_GROUPS = [
    {
        id: 'video',
        label: 'Video',
        options: [
            {
                key: 'renderFilter',
                label: 'Image filtering',
                description: 'Scaling filter applied when the picture is stretched to the canvas. Pixelated keeps pixel art crisp; smooth softens it.',
                type: 'enum',
                default: DEFAULT_SNES9X_OPTIONS.renderFilter,
                values: [
                    { value: 'pixelated', label: 'Pixelated' },
                    { value: 'smooth', label: 'Smooth' },
                ],
            },
            {
                key: 'aspect',
                label: 'Aspect ratio',
                description: 'Presented aspect ratio: 4:3 is the picture as it looked on a CRT; 1:1 shows square pixels.',
                type: 'enum',
                default: DEFAULT_SNES9X_OPTIONS.aspect,
                values: [
                    { value: '4:3', label: '4:3' },
                    { value: '1:1', label: '1:1' },
                ],
            },
            {
                key: 'cropOverscan',
                label: 'Crop overscan',
                description: 'Crop the picture to 224 lines. Off shows the full 239-line output, including the rows many games leave as garbage.',
                type: 'boolean',
                default: DEFAULT_SNES9X_OPTIONS.cropOverscan,
            },
        ],
    },
    {
        id: 'audio',
        label: 'Audio',
        options: [
            {
                key: 'volume',
                label: 'Volume',
                description: 'Master audio volume.',
                type: 'number',
                default: DEFAULT_SNES9X_OPTIONS.volume,
                values: [
                    { value: 0, label: 'Mute' },
                    { value: 0.25, label: '25%' },
                    { value: 0.5, label: '50%' },
                    { value: 0.75, label: '75%' },
                    { value: 1, label: '100%' },
                ],
                range: { minimum: 0, maximum: 1 },
            },
            {
                key: 'interpolation',
                label: 'DSP interpolation',
                description: 'How the DSP resamples its 8-bit samples. Gaussian is what the real hardware does; the others trade accuracy for sharpness.',
                type: 'enum',
                default: DEFAULT_SNES9X_OPTIONS.interpolation,
                values: [
                    { value: 'none', label: 'None' },
                    { value: 'linear', label: 'Linear' },
                    { value: 'gaussian', label: 'Gaussian' },
                    { value: 'cubic', label: 'Cubic' },
                    { value: 'sinc', label: 'Sinc' },
                ],
            },
        ],
    },
    {
        id: 'emulation',
        label: 'Emulation',
        options: [
            {
                key: 'region',
                label: 'Region',
                description: 'Video standard: auto follows the cartridge header, or force NTSC (60.098Hz) / PAL (50.007Hz). The core reads it while mapping the cartridge, so the game restarts to apply it.',
                type: 'enum',
                default: DEFAULT_SNES9X_OPTIONS.region,
                requiresReset: true,
                values: [
                    { value: 'auto', label: 'Auto' },
                    { value: 'ntsc', label: 'NTSC' },
                    { value: 'pal', label: 'PAL' },
                ],
            },
            {
                key: 'maxSpriteTilesPerLine',
                label: 'Sprite limit',
                description: 'Sprite tiles drawn per scanline. 34 matches hardware, flicker included; 128 removes sprite dropout.',
                type: 'number',
                default: DEFAULT_SNES9X_OPTIONS.maxSpriteTilesPerLine,
                integer: true,
                values: [
                    { value: 34, label: 'Hardware' },
                    { value: 128, label: 'No limit' },
                ],
            },
            {
                key: 'superFXClockMultiplier',
                label: 'Super FX clock',
                description: 'Super FX clock as a percentage of stock. Above 100 speeds up Star Fox / Yoshi’s Island; it is a hack, not accuracy.',
                type: 'number',
                default: DEFAULT_SNES9X_OPTIONS.superFXClockMultiplier,
                integer: true,
                values: [
                    { value: 50, label: '50%' },
                    { value: 100, label: '100%' },
                    { value: 200, label: '200%' },
                    { value: 400, label: '400%' },
                ],
                range: { minimum: 50, maximum: 400 },
            },
        ],
    },
    {
        id: 'controllers',
        label: 'Controllers',
        options: [
            {
                key: 'multitap',
                label: 'Multitap',
                description: 'Emulate the 5-player Multitap in controller port 2, giving pads 2-5. Only a handful of games support it.',
                type: 'boolean',
                default: DEFAULT_SNES9X_OPTIONS.multitap,
            },
            {
                key: 'gamepads',
                label: 'Gamepads',
                description: 'Poll connected gamepads (standard mapping) each frame.',
                type: 'boolean',
                default: DEFAULT_SNES9X_OPTIONS.gamepads,
            },
        ],
    },
    {
        id: 'debug',
        label: 'Debug',
        options: [
            {
                key: 'logLevel',
                label: 'Core logging',
                description: 'Core messages printed to the browser console: errors and warnings, or also its informational ones.',
                type: 'enum',
                default: DEFAULT_SNES9X_OPTIONS.logLevel,
                values: [
                    { value: 'off', label: 'Off' },
                    { value: 'error', label: 'Errors' },
                    { value: 'debug', label: 'Debug' },
                ],
            },
        ],
    },
];
/** Flat view of every runtime-tweakable option across all groups. */
export const SNES9X_ENGINE_OPTIONS = SNES9X_OPTION_GROUPS.flatMap((group) => group.options);
const OPTION_BY_KEY = new Map(SNES9X_ENGINE_OPTIONS.map((option) => [option.key, option]));
export function snes9xOption(key) {
    return OPTION_BY_KEY.get(key);
}
/**
 * Coerces a host- or storage-supplied value to what the option accepts,
 * returning `undefined` when it is not a value the option can take. Numbers
 * outside a `range` are clamped rather than rejected, matching how the core
 * treats them; enums are exact.
 */
export function coerceOptionValue(option, value) {
    if (option.type === 'boolean') {
        return typeof value === 'boolean' ? value : undefined;
    }
    if (option.type === 'enum') {
        const next = String(value);
        return option.values.some((choice) => choice.value === next) ? next : undefined;
    }
    const next = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(next))
        return undefined;
    if (option.range) {
        return Math.min(option.range.maximum, Math.max(option.range.minimum, next));
    }
    return option.values.some((choice) => choice.value === next) ? next : undefined;
}
function schemaForOption(option) {
    if (option.type === 'boolean') {
        return { type: 'boolean', default: option.default, description: option.description };
    }
    if (option.type === 'enum') {
        return {
            type: 'string',
            enum: option.values.map((choice) => choice.value),
            default: option.default,
            description: option.description,
        };
    }
    return {
        type: option.integer ? 'integer' : 'number',
        default: option.default,
        ...(option.range
            ? { minimum: option.range.minimum, maximum: option.range.maximum }
            : { enum: option.values.map((choice) => choice.value) }),
        description: option.description,
    };
}
export const SNES9X_OPTIONS_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        ...Object.fromEntries(SNES9X_ENGINE_OPTIONS.map((option) => [option.key, schemaForOption(option)])),
        escMenu: {
            type: 'boolean',
            default: true,
            description: 'Show the built-in in-game settings menu when the player presses Escape.',
        },
    },
};
//# sourceMappingURL=snes9x.options.js.map