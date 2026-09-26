import { coerceOptionValue, snes9xOption, SNES9X_ENGINE_OPTIONS, } from './snes9x.options.js';
export function bindConfig(state, appliers) {
    const applierFor = (key) => appliers[key];
    const supports = (key) => Boolean(snes9xOption(key)) && applierFor(key) !== undefined;
    const read = (key) => snes9xOption(key) ? state[key] : undefined;
    const write = (key, value) => {
        const option = snes9xOption(key);
        const apply = applierFor(key);
        if (!option || !apply)
            return false;
        const next = coerceOptionValue(option, value);
        if (next === undefined)
            return false;
        state[key] = next;
        apply(next);
        return true;
    };
    return {
        supports,
        read,
        write,
        values() {
            const snapshot = {};
            for (const option of SNES9X_ENGINE_OPTIONS) {
                if (supports(option.key))
                    snapshot[option.key] = state[option.key];
            }
            return snapshot;
        },
        restoreDefaults() {
            for (const option of SNES9X_ENGINE_OPTIONS) {
                write(option.key, option.default);
            }
        },
    };
}
export function createSettingsStore(namespace) {
    const storageKey = `snes9x:options:${namespace}`;
    // Storage access throws outright in some privacy modes, so every call is
    // guarded — losing persistence must never take the emulator down with it.
    const storage = () => {
        try {
            return typeof localStorage === 'undefined' ? null : localStorage;
        }
        catch {
            return null;
        }
    };
    return {
        load() {
            try {
                const raw = storage()?.getItem(storageKey);
                if (!raw)
                    return {};
                const parsed = JSON.parse(raw);
                if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                    return {};
                // Anything the catalog no longer recognizes is dropped rather than fed
                // back into the core: this is user-writable storage.
                const values = {};
                for (const [key, value] of Object.entries(parsed)) {
                    const option = snes9xOption(key);
                    if (!option)
                        continue;
                    const coerced = coerceOptionValue(option, value);
                    if (coerced !== undefined)
                        values[key] = coerced;
                }
                return values;
            }
            catch {
                return {};
            }
        },
        save(values) {
            try {
                storage()?.setItem(storageKey, JSON.stringify(values));
            }
            catch {
                // persistence is best-effort
            }
        },
        clear() {
            try {
                storage()?.removeItem(storageKey);
            }
            catch {
                // persistence is best-effort
            }
        },
    };
}
//# sourceMappingURL=snes9x.config.js.map