/* __geekez_oninstalled_shim__ */
/* __geekez_original_worker__:background.js */
(() => {
  try {
    const runtime = globalThis.chrome?.runtime || globalThis.browser?.runtime;
    const storage = globalThis.chrome?.storage?.local || globalThis.browser?.storage?.local;
    if (!runtime?.onInstalled?.addListener || !storage?.get || !storage?.set) return;

    const KEY = '__geekez_extension_seen_once__';
    const originalAddListener = runtime.onInstalled.addListener.bind(runtime.onInstalled);

    const readSeen = (callback) => {
      try {
        if (storage.get.length >= 2) {
          storage.get([KEY], (result) => callback(!!(result && result[KEY])));
          return;
        }
        Promise.resolve(storage.get(KEY))
          .then((result) => callback(!!(result && result[KEY])))
          .catch(() => callback(false));
      } catch (e) {
        callback(false);
      }
    };

    const markSeen = () => {
      try {
        if (storage.set.length >= 2) {
          storage.set({ [KEY]: Date.now() }, () => {});
          return;
        }
        storage.set({ [KEY]: Date.now() });
      } catch (e) {}
    };

    runtime.onInstalled.addListener = (listener) => {
      if (typeof listener !== 'function') {
        return originalAddListener(listener);
      }

      const wrapped = (details) => {
        const originalDetails = details;
        const emit = (payload) => {
          try {
            listener(payload);
          } catch (e) {
            try { listener(originalDetails); } catch (inner) {}
          }
        };

        readSeen((seen) => {
          if (!seen) {
            markSeen();
            emit(originalDetails);
            return;
          }

          if (originalDetails && originalDetails.reason === 'install') {
            const mapped = Object.assign({}, originalDetails, { reason: 'update' });
            if (!mapped.previousVersion) {
              try {
                mapped.previousVersion = runtime.getManifest?.().version || '';
              } catch (e) {}
            }
            emit(mapped);
            return;
          }

          emit(originalDetails);
        });
      };

      return originalAddListener(wrapped);
    };
  } catch (e) {}
})();

try { importScripts('./background.js'); } catch (e) {}
