const ADDON_NAME = "YMLiberty";

function log(...args: any[]) {
    console.debug("[" + ADDON_NAME + "]", ...args);
}

let YMLibertyInitialized = false;
let observer: MutationObserver | null = null;

export async function initYMLiberty() {
    if (YMLibertyInitialized) return;
    
    // Ожидание инициализации движка Яндекса (Next.js/Webpack)
    // Убедимся, что webpackChunk_N_E существует и метод push переопределен вебпаком (отличается от стандартного Array.push)
    if (!(window as any).webpackChunk_N_E || (window as any).webpackChunk_N_E.push === Array.prototype.push) {
        setTimeout(initYMLiberty, 100);
        return;
    }

    YMLibertyInitialized = true;

    /* == получение метода require из webpack == */
    const webpackGlobal = (window as any).webpackChunk_N_E;
    let appRequire: any = null;

    webpackGlobal.push([[Symbol("requireGetter__" + ADDON_NAME)],
        {},
        (internalRequire: any) => {
            appRequire = internalRequire;
        }
    ]);
    webpackGlobal.pop();

    if (!appRequire) {
        console.error("Failed to get appRequire func");
        return;
    }

    // получение DI модуля (оно хранит все синглтоны необходимые для работы аддона)
    function findModule(...requiredStrings: string[]) {
        for (const id in appRequire.m) {
            try {
                const mod = appRequire(id);
                const moduleStr = Object.keys(mod);
                if (requiredStrings.every(str => moduleStr.includes(str))) {
                    return mod;
                }
            } catch(e) {
                log(`Ошибка при поиске модуля ${id}`, e);
            }
        }
        return null;
    }

    const diModule = findModule("Dt", "P9", "Gr", "do");
    if (!diModule?.Dt) {
        console.error("Failed to find DI module. Wait for addon update!");
        return;
    }
    
    const di = diModule.Dt;
    const originalDiGet = di.prototype.get;

    // хук получения DI
    let hooked = false;
    di.prototype.get = function(this: any, ...args: any[]) {
        const result = originalDiGet.apply(this, args);

        if (!hooked) {
            const gfir = this.shared?.get("GetFileInfoResource");
            
            if (gfir) {
                hooked = true;
                di.prototype.get = originalDiGet; 
                hookMethods(gfir);
            }
        }
        
        return result;
    };

    let _notificationComponentsCache: any = null;
    function getNotificationComponents() {
        if (_notificationComponentsCache) return _notificationComponentsCache;

        const notificationManager = findModule("Notification", "notification", "dismiss")
        const React = findModule("createElement", "cacheSignal", "createContext", "createRef", "forwardRef")
        const NotificationComponent = findModule("$W", "NX", "fJ", "cp", "hT", "OM", "DZ")
        const Typography = findModule("Caption", "Heading")
        const PaperComponent = findModule("Paper")?.Paper
        const styles = findModule("message", "cover", "image", "text")

        _notificationComponentsCache = {
            notificationManager: notificationManager,
            React: React,
            NotificationComponent: NotificationComponent,
            Typography: Typography,
            PaperComponent: PaperComponent,
            styles: styles
        }
        return _notificationComponentsCache;
    }

    function postNotification(caption: string, image: string | null = null) {
        const { notificationManager, React, NotificationComponent, Typography, PaperComponent, styles } = getNotificationComponents();
        const children = [];

        if (image && PaperComponent) {
          const img = React.createElement(NotificationComponent.BW, {
            className: styles.image,
            src: image,
            alt: "cover",
            size: 100,
            fit: "cover",
            withAvatarReplace: true
          });

          const paper = React.createElement(PaperComponent, {
            className: styles.cover,
            radius: "s",
          }, img);

          children.push(paper);
        }

        const text = React.createElement(Typography.Caption, {
          className: styles.text,
          variant: "div",
          type: "controls",
          size: "m",
          "aria-hidden": true
        }, caption);

        children.push(text);

        const content = React.createElement("div", {
          className: styles.message
        }, ...children);

        const ctr = React.createElement(NotificationComponent.$W, { 
          message: content 
        });

        notificationManager?.notification({
          message: ctr,
          options: { autoClose: 2e3, closeOnClick: true, pauseOnHover: true, draggable: false, single: true, containerId: "INFO"},
        });
    }

    function postNotificationWithCover(caption: string, trackId: string) {
        const currentTrack = (window as any).pulsesyncApi?.getCurrentTrack();
        const coverUri = currentTrack && currentTrack.id == trackId ? currentTrack.coverUri : null;
        postNotification(caption, coverUri);
    }

    // основной код аддона, выполняется после инициализации DI
    function hookMethods(gfir: any) {
        const originalGetFileInfo = gfir.getLocalFileDownloadInfo;
        gfir.getLocalFileDownloadInfo = async function(this: any, trackId: string, ...args: any[]) {
            const replacedTrack = getReplaced(trackId);
            
            if (replacedTrack && replacedTrack.src !== "remote_exception") {
                let url = replacedTrack.url;
                
                if (replacedTrack.src === "local" && !replacedTrack.url) {
                    url = await getLocalTrackUrl(trackId);
                }

                if (url) {
                    log("Replacing track " + trackId + " with url " + url);
                    return {
                        trackId: trackId,
                        urls: [url]
                    };
                }
            }
            return originalGetFileInfo.apply(this, [trackId, ...args]);
        };

        const originalIsDownloaded = gfir.isTrackDownloaded;
        gfir.isTrackDownloaded = async function(this: any, trackId: string, ...args: any[]) {
            const replacedTrack = getReplaced(trackId);
            if (replacedTrack && replacedTrack.src !== "remote_exception") {
                return true;
            }
            return originalIsDownloaded.apply(this, [trackId, ...args]);
        };
    }

    // === хранение подменных треков ===
    /* из базы данных */
    let localTracksUrlCache: Record<string, string> = {};
    let localTrackIds: string[] = [];

    async function getLocalTrackUrl(trackId: string): Promise<string | null> {
        if (localTracksUrlCache[trackId]) return localTracksUrlCache[trackId];

        const db = await openDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction("tracks", 'readonly');
            const store = tx.objectStore("tracks");
            const request = store.get(trackId); 

            request.onsuccess = () => {
                if (request.result && request.result.data) {
                    const url = URL.createObjectURL(request.result.data);
                    localTracksUrlCache[trackId] = url;
                    resolve(url);
                } else {
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // открытие базы данных
    let dbPromise: Promise<IDBDatabase> | null = null;
    function openDB(): Promise<IDBDatabase> {
        if (!dbPromise) {
            dbPromise = new Promise((resolve, reject) => {
                const request = indexedDB.open(ADDON_NAME + "Data", 3);

                request.onupgradeneeded = (event: any) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains("tracks")) {
                        db.createObjectStore("tracks", { keyPath: "id" });
                    }

                    if (!db.objectStoreNames.contains("remote_exceptions")) {
                        db.createObjectStore("remote_exceptions", { keyPath: "id" });
                    }

                    if (!db.objectStoreNames.contains("reported_tracks")) {
                        db.createObjectStore("reported_tracks", { keyPath: "id" });
                    }
                };

                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }
        return dbPromise;
    }

    // первоначальная загрузка треков из базы данных
    openDB().then(db => {
        const tx = db.transaction("tracks", 'readonly');
        const store = tx.objectStore("tracks");
        const request = store.getAllKeys(); 

        request.onsuccess = () => {
            localTrackIds = request.result as string[];
            log("Loaded ", localTrackIds.length, "local tracks");
        };
    });

    /* из репозитория */
    let remoteTracks: Record<string, string> = {};
    let remoteExceptions: string[] = [];

    function updateRemoteTracks() {
        fetch(`https://raw.githubusercontent.com/gagayhhad-tech/ym-liberty-db/refs/heads/main/list.json?t=${Date.now()}`)
            .then(response => response.json())
            .then(data => {
                const isFirstLoad = Object.keys(remoteTracks).length === 0;
                remoteTracks = data.tracks;
                if (isFirstLoad) log("Tracks from remote repository:", remoteTracks);
                openDB().then(db => {
                    const tx = db.transaction("remote_exceptions", "readonly");
                    const store = tx.objectStore("remote_exceptions");
                    const request = store.getAll();
                    request.onsuccess = () => {
                        remoteExceptions = request.result.map((item: any) => String(item.id));
                    };
                });
            })
            .catch(err => {
                console.error(`[YMLiberty] Error fetching tracks: `, err)
            });
    }
    updateRemoteTracks();
    setInterval(updateRemoteTracks, 30000);
    // получение ссылки на трек
    function getReplaced(trackId: string | number | undefined | null) {
        if (!trackId) return null;
        trackId = String(trackId);
        let url: string | null = null;
        let src: string | null = null;
        if  (localTrackIds.includes(trackId)) {
            url = localTracksUrlCache[trackId];
            src = "local";
        }
        else if (remoteExceptions.includes(trackId)) {
            url = null;
            src = "remote_exception";
        }
        else if (remoteTracks[trackId]) {
            url = remoteTracks[trackId];
            src = "remote";
        }
        return url || src ? { url, src } : null;
    }

    (window as any).getYMLibertyTrackUrlAsync = async (tId: string) => {
        const replacedTrack = getReplaced(tId);
        if (replacedTrack && replacedTrack.src !== "remote_exception") {
            let url = replacedTrack.url;
            if (replacedTrack.src === "local" && !replacedTrack.url) {
                url = await getLocalTrackUrl(tId);
            }
            return url;
        }
        return null;
    };

    function isReplaced(trackId: string | number | undefined | null) {
        const replacedData = getReplaced(trackId);
        return !!(replacedData && replacedData.src !== "remote_exception");
    }

    // апи для отправки заблюренных треков
    const api = {
        API_URL: "https://ym-liberty-bot.vercel.app/api/bot",
        reportedTracks: [] as number[],
        report(trackId: any, replaced: boolean) {
            if (!trackId) return;
            trackId = Number(trackId);
            if (isNaN(trackId) || this.reportedTracks.includes(trackId)) return;

            const body = {
                type: 'report',
                track_id: trackId,
                replaced
            }

            fetch(this.API_URL, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(body)
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Failed to report track. Status: ${response.status}`);
                }
                this.reportedTracks.push(trackId);
                openDB().then(db => {
                    const tx = db.transaction('reported_tracks', 'readwrite');
                    const store = tx.objectStore('reported_tracks');
                    store.put({ id: trackId });
                });
                log("Reported track " + trackId);
            })
            .catch(err => {
                console.error(`[${ADDON_NAME}] Failed to report track`, err);
            });
        },
        loadReportedTracks() {
            openDB().then(db => {
                const tx = db.transaction("reported_tracks", 'readonly');
                const store = tx.objectStore("reported_tracks");
                const request = store.getAll();

                request.onsuccess = () => {
                    this.reportedTracks = request.result.map((item: any) => Number(item.id));
                };
            });
        },
        isReported(trackId: any) {
            if (!trackId) return;
            trackId = Number(trackId);
            return !isNaN(trackId) && this.reportedTracks.includes(trackId);
        }
    }

    api.loadReportedTracks();

    /* === контекстное меню подмены (сохранение в indexeddb) === */
    function onContextMenuReplaceClick(trackId: string, item: HTMLElement) {
        const replaced = getReplaced(trackId);

        function reloadPlayer() { 
            const e = (window as any).sonataState?.queueState?.currentEntity?.value?.entity;
            const mediaPlayer = (window as any).sonataState?.currentMediaPlayer?.value?.currentMediaPlayer;
            if (e && mediaPlayer && e.entityData?.meta?.id == trackId) {
                mediaPlayer.reload(e);
                log("Player reloaded");
            }
        }

        function onSuccess() {
            reloadPlayer();
            updateReplaceItem(trackId, item);
            addReplacedMarks();
        }

        function notificate(replaced: boolean) {
            const text = !replaced ? "Трек успешно подменён" : "Трек восстановлен к оригиналу"
            postNotificationWithCover(text, trackId);
        }

        if (!replaced) {
            (window as any).showOpenFilePicker({
                types:
                [
                    {
                        description: 'Аудио-файлы',
                        accept: { 'audio/*': ['.mp3', '.wav', '.ogg', '.flac'] }
                    }
                ],
                multiple: false 
            })
            .then(async (fileHandles: any[]) => {
                const fileHandle = fileHandles[0];

                const file = await fileHandle.getFile();
                if (!file.type.startsWith("audio/")) {
                    postNotification("Выбранный файл не является аудио-файлом.");
                    return;
                }
                const db = await openDB();

                localTrackIds.push(String(trackId))
                localTracksUrlCache[trackId] = URL.createObjectURL(file);

                const tx = db.transaction("tracks", 'readwrite');
                const store = tx.objectStore("tracks");
                
                store.put({ id: String(trackId), data: file });
                api.report(trackId, true);
                onSuccess();
                notificate(true);
                log("Added track " + trackId + " to local tracks");
            })
            .catch((err: any) => {
                if (err.name !== 'AbortError') {
                    postNotification("Ошибка во время выбора файла, посмотрите консоль для подробной информации.")
                    console.error(`[${ADDON_NAME}] Ошибка при выборе файла:`, err);
                }
            });
        }
        else if (replaced.src == "local") {
            localTrackIds = localTrackIds.filter(id => id != trackId);
            
            if (localTracksUrlCache[trackId]) {
                URL.revokeObjectURL(localTracksUrlCache[trackId]);
                delete localTracksUrlCache[trackId];
            }
            
            openDB().then(db => {
                const tx = db.transaction("tracks", 'readwrite');
                const store = tx.objectStore("tracks");
                store.delete(String(trackId));
                onSuccess();
                notificate(false);
                log("Removed track " + trackId + " from local tracks");
            });
        }
        else if (replaced.src == "remote") {
            remoteExceptions.push(String(trackId));
            openDB().then(db => {
                const tx = db.transaction("remote_exceptions", 'readwrite');
                const store = tx.objectStore("remote_exceptions");
                store.add({ id: String(trackId) });
                onSuccess();
                notificate(true);
                log("Added track " + trackId + " to remote exceptions");
            });
        }
        else if (replaced.src == "remote_exception") {
            remoteExceptions = remoteExceptions.filter(id => id != trackId);
            openDB().then(db => {
                const tx = db.transaction("remote_exceptions", 'readwrite');
                const store = tx.objectStore("remote_exceptions");
                store.delete(String(trackId));
                onSuccess();
                notificate(false);
                log("Removed track " + trackId + " from remote exceptions");
            });
        }
    }

    function updateReplaceItem(trackId: string, item: HTMLElement) {
        const span = item.querySelector('span');
        if (!span) return;
        const replaced = isReplaced(trackId);

        (span.childNodes[0].firstElementChild as Element).setAttribute("xlink:href", "/icons/sprite.svg#" + (replaced ? "close" : "edit") + "_xxs");
        span.childNodes[1].nodeValue = replaced ? "Удалить замену" : "Подменить трек";

        const ymTrackDownloadItem = item.parentElement?.querySelector('[data-test-id="CONTEXT_MENU_DOWNLOAD_BUTTON"]') as HTMLElement | null;
        if (ymTrackDownloadItem) {
            ymTrackDownloadItem.style.display = replaced ? "none" : "";
        }

        updateReportItem(trackId, item.parentElement?.querySelector('[data-test-id="CONTEXT_MENU_REPORT_BUTTON"]') as HTMLElement | null)
    }

    function updateReportItem(trackId: string, item: HTMLElement | null, forcedValue: boolean | undefined = undefined) {
        if (!item || !trackId) return;
        item.style.display = (forcedValue !== undefined && forcedValue !== null ? forcedValue : (api.isReported(trackId) || getReplaced(trackId))) ? "none" : "";
    }

    observer = new MutationObserver(async mutations => {

        mutations.forEach(mutation => {
            mutation.addedNodes.forEach(node => {
                if (!(node instanceof HTMLElement)) return;
                // появилось ли контекстное меню трека?
                const trackMenu = node?.querySelector("[data-test-id='TRACK_CONTEXT_MENU']:not(:has([data-test-id='CONTEXT_MENU_REPLACE_BUTTON']))");
                if (trackMenu) {
                    const button = (trackMenu.parentElement as any)?.ariaLabelledByElements?.[0] || (trackMenu as any).ariaLabelledByElements?.[0];
                    if (button) {
                        function createItems(trackId: string) {
                            const replaced = getReplaced(trackId);
                            if (trackId && replaced?.src != "assets") {
                                const downloadItem = trackMenu?.querySelector('[data-test-id="CONTEXT_MENU_DOWNLOAD_BUTTON"]') as HTMLElement | null;
                                if (downloadItem && downloadItem.parentElement) {
                                    // создаем кнопку подмены
                                    const replaceItem = downloadItem.cloneNode(true) as HTMLElement;
                                    replaceItem.setAttribute('data-test-id', 'CONTEXT_MENU_REPLACE_BUTTON');
                                    replaceItem.addEventListener('click', () => onContextMenuReplaceClick(trackId, replaceItem));

                                    downloadItem.parentElement.insertBefore(replaceItem, downloadItem.nextSibling);
                                    updateReplaceItem(trackId, replaceItem);

                                    // создаем кнопку репорта блюра
                                    const reportItem = downloadItem.cloneNode(true) as HTMLElement;
                                    reportItem.setAttribute('data-test-id', 'CONTEXT_MENU_REPORT_BUTTON');

                                    const span = reportItem.querySelector("span");
                                    if (span) {
                                        (span.childNodes[0].firstElementChild as Element).setAttribute("xlink:href", "/icons/sprite.svg#" + "attention_xxxl");
                                        span.childNodes[1].nodeValue = "Сообщить о цензуре";
                                    }

                                    reportItem.addEventListener('click', () => {
                                        api.report(trackId, false);
                                        updateReportItem(trackId, reportItem, true)
                                        postNotificationWithCover("Спасибо! Трек скоро будет добавлен в список автоматически заменяемых", trackId)
                                    });

                                    downloadItem.parentElement.insertBefore(reportItem, replaceItem.nextSibling);
                                    updateReportItem(trackId, reportItem)
                                }
                            }
                        }
                        // а относится ли контекстное меню к плееру?
                        if (button.matches("[data-test-id='PLAYERBAR_DESKTOP_CONTEXT_MENU_BUTTON'], [data-test-id='FULLSCREEN_PLAYER_CONTEXT_MENU_BUTTON']")) {
                            const entity = (window as any).pulsesyncApi?.getCurrentTrack();
                            createItems(entity?.id)
                        }
                        else {
                            const source = button.closest('.CommonTrack_root__i6shE');
                            if (source) {
                                const trackId = getTrackIdFromNode(source);
                                if (trackId) {
                                    createItems(trackId)
                                }
                            }
                        }
                    }
                }
            })
            
            addReplacedMarks(mutation.target as HTMLElement);
        });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    /* === иконка подмены === */
    function createMark(node: Element) {
        const metaCtr = node.querySelector(".Meta_titleContainer__gDuXr:not(:has(.Meta_replacedMarkContainer))")
        if (!metaCtr) return;
        const span = document.createElement("span");

        span.classList.add("Meta_replacedMarkContainer", "Meta_explicitMarkContainer__BxMQg")
        span.innerHTML = 
        `<svg 
            class="ExplicitMarkIcon_explicitMark__0BPeQ Meta_explicitMark__ocnCV Rkdd2vKC_3xa1eUdRdHP" 
            focusable="false" 
            aria-label="Трек подменен аддоном ${ADDON_NAME}" 
            data-test-id="REPLACED_MARK_ICON">
                <use xlink:href="/icons/sprite.svg#edit_xxs">
                </use>
        </svg>`

        const trackOptionsButton = metaCtr.querySelector(`div:has([data-test-id="PLAYERBAR_DESKTOP_CONTEXT_MENU_BUTTON"])`);
        if (trackOptionsButton) {
            metaCtr.insertBefore(span, trackOptionsButton);
        }
        else {
            metaCtr.appendChild(span)
        }

        span.addEventListener("mouseenter", (ev: any) => {
            removeTooltip();
            const tooltip = document.createElement("div");
            tooltip.id = "YMLibertyTooltip";
            const bounding = ev.target.getBoundingClientRect();
            tooltip.innerHTML = 
            `<div 
                class="QhR4J536RmNHBB5bZYwF TooltipWithTitle_root__7jLY3" 
                data-test-id="TOOLTIP_WITH_TITLE" 
                tabindex="-1"
                role="tooltip" 
                style="position: absolute; left: 0px; top: 0px; visibility: visible; transform: translate(${bounding.left}px, ${bounding.top + bounding.height}px);">
                <div 
                    class="_MWOVuZRvUQdXKTMcOPx Ai2iRN9elHpk_u5splD6 _3_Mxw7Si7j2g4kWjlpR Fqg1VWCJUfasVVxqICeO">
                    <div 
                        class="TooltipWithTitle_text__ElBtq">
                        <span 
                            class="_MWOVuZRvUQdXKTMcOPx Ai2iRN9elHpk_u5splD6 ZYV27jeWd30QDXu4GhaH TooltipWithTitle_description__HsGcR"
                            >${ev.target.firstElementChild.ariaLabel}</span>
                    </div>
                </div>
                </div>`
            document.body.appendChild(tooltip);
            tooltip.addEventListener("mouseenter", (ev: any) => ev.target.remove());
        });
        span.addEventListener("mouseleave", (_) => removeTooltip());
    }

    function removeTooltip() {
        document.getElementById("YMLibertyTooltip")?.remove();
    }

    function getTrackIdFromNode(node: any) {
        let trackId = null;
        const reactFiberProp = Object.keys(node).find(key => key.startsWith("__reactFiber"));
        if (reactFiberProp) {
            const fiber = node[reactFiberProp];
            const children = fiber.memoizedProps?.children
            if (children && Array.isArray(children)) {
                for (const child of children) {
                    trackId = child?.props?.track?.id;
                    if (trackId) break;
                }
            } else if (children?.props?.track?.id) {
                trackId = children.props.track.id;
            }
        }

        if (!trackId) {
            const intersection = node.dataset?.intersectionPropertyId;
            trackId = intersection?.match(/track_(\d+)/)?.[1];
        }
        return trackId;
    }

    function addReplacedMarks(node: HTMLElement = document.body) {
        const trackContainers = node.querySelectorAll('.CommonTrack_root__i6shE')
        trackContainers.forEach(ctr => {
            const trackId = getTrackIdFromNode(ctr);
            if (trackId) {
                const replaced = isReplaced(trackId);
                if (replaced) {
                    createMark(ctr);
                }
                else {
                    ctr.querySelector(".Meta_replacedMarkContainer")?.remove()
                }
            }
        })
        updatePlayerbarReplacedMark(node);
    }

    function updatePlayerbarReplacedMark(node: HTMLElement = document.body) {
        try {
            const playerContainers = node.querySelectorAll('[data-test-id="PLAYERBAR_DESKTOP"], [data-test-id="FULLSCREEN_PLAYER_FULLSCREEN_CONTENT"]');
            if (playerContainers.length == 0) return;
            const entity = (window as any).pulsesyncApi?.getCurrentTrack();
            const replaced = isReplaced(entity?.id);
            playerContainers.forEach(ctr => {
                if (replaced) {
                    createMark(ctr);
                }
                else {
                    ctr.querySelectorAll(".Meta_replacedMarkContainer").forEach(rpctr => {
                        rpctr.remove();
                    })
                }
            })
        }
        catch (e) {
            console.error(e)
        }
    }

    const waitForPlayer = (window as any).pulsesyncApi?._waitForPlayer;
    if (waitForPlayer) {
        waitForPlayer((player: any) => {
            updatePlayerbarReplacedMark()
            player.state?.queueState?.currentEntity?.onChange(() => updatePlayerbarReplacedMark())
        });
    }

    addReplacedMarks();
}

initYMLiberty();


