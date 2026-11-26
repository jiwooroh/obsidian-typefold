/* Typefold — folders as object types: navigator, type pages, Home, new-tab search, view tabs for Bases (plain JS) */
const {
  Plugin, ItemView, PluginSettingTab, Setting, Modal, SuggestModal, Notice, MarkdownRenderChild, AbstractInputSuggest, TFolder, Menu, MarkdownView, Platform,
  Keymap, setIcon: obsidianSetIcon, getIconIds, prepareFuzzySearch, debounce, normalizePath, moment, editorInfoField, getAllTags, requestUrl,
} = require("obsidian");
const { ViewPlugin, Decoration, WidgetType } = require("@codemirror/view");
const { RangeSetBuilder } = require("@codemirror/state");

let ICONIZE_API = () => null;
/** Lucide ids are kebab-case; Iconize pack icons are PascalCase with a pack prefix (FasCircle, BoBxsFolder, LiBrain) */
function setIcon(el, id, color) {
  if (id && /^[A-Z]/.test(id)) {
    const api = ICONIZE_API();
    if (id.startsWith("Li") && !api) { obsidianSetIcon(el, id.slice(2).replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()); return; }
    if (api) {
      const k = id + "|" + (color || "");
      const cached = SVG_CACHE.get(k);
      if (cached != null) { el.innerHTML = cached; return; }
      try { api.setIconForNode(id, el, color); SVG_CACHE.set(k, el.innerHTML); return; } catch (e) {}
    }
  }
  obsidianSetIcon(el, id);
}
const SVG_CACHE = new Map();
const OPEN_MODALS = new Set();

/** search Lucide + every Iconize icon pack (Boxicons, Font Awesome, …) */
function searchIcons(q, limit = 240) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const out = [];
  const lucide = (getIconIds?.() || []).map((id) => id.replace(/^lucide-/, ""));
  for (const id of lucide) { if (id.includes(q)) out.push(id); if (out.length >= limit / 2) break; }
  const api = ICONIZE_API();
  const qn = q.replace(/[-\s]/g, "");
  for (const pack of api?.getAllIconPacks?.() || []) {
    if (pack.prefix === "Li") continue; // native Lucide already listed
    for (const icon of pack.icons || []) {
      if (out.length >= limit) return out;
      if (icon.name?.toLowerCase().includes(qn)) out.push((icon.prefix || pack.prefix) + icon.name);
    }
  }
  return out;
}

const VIEW_TYPE = "typefold-view";
const HOME_VIEW = "typefold-home";
const TASKS_VIEW = "typefold-tasks";
const LEGACY_VIEWS = { "object-types-view": VIEW_TYPE, "object-types-home": HOME_VIEW };

/* Apple system colors (light) */
const NO_COLOR = "var(--text-muted)";
const COLORS = [
  { name: "Red", hex: "#FF3B30" },
  { name: "Orange", hex: "#FF9500" },
  { name: "Yellow", hex: "#FFCC00" },
  { name: "Green", hex: "#34C759" },
  { name: "Mint", hex: "#00C7BE" },
  { name: "Cyan", hex: "#32ADE6" },
  { name: "Blue", hex: "#007AFF" },
  { name: "Indigo", hex: "#5856D6" },
  { name: "Purple", hex: "#AF52DE" },
  { name: "Pink", hex: "#FF2D55" },
  { name: "Brown", hex: "#A2845E" },
  { name: "Gray", hex: "#8E8E93" },
];

const SUGGESTED_ICONS = [
  "user", "users", "book", "book-open", "library", "file-text", "sticky-note", "notebook-pen", "newspaper", "bookmark",
  "lightbulb", "brain", "atom", "flask-conical", "graduation-cap", "school", "briefcase", "folder-kanban", "target", "rocket",
  "check-circle-2", "list-todo", "calendar", "calendar-days", "clock", "map-pin", "map", "plane", "home", "building-2",
  "palette", "brush", "image", "film", "music", "headphones", "camera", "quote", "message-square", "mail",
  "scale", "gavel", "landmark", "globe", "link", "code", "terminal", "database", "cpu", "bot",
  "chart-line", "chart-bar", "sigma", "calculator", "heart", "star", "flag", "tag", "box", "shapes",
  "coffee", "utensils", "dumbbell", "leaf", "sun", "moon", "zap", "flame", "gem", "trophy",
];

const ICON_GUESS = [
  [/person|people|human|contact|사람|인물/, "user"], [/book|책|reading/, "book"], [/paper|논문|article/, "file-text"],
  [/project|프로젝트/, "folder-kanban"], [/task|todo|할 ?일/, "check-circle-2"], [/meeting|면담|interview/, "users"],
  [/school|학교|grad|university/, "graduation-cap"], [/idea|아이디어/, "lightbulb"], [/concept|개념/, "atom"],
  [/place|장소|location/, "map-pin"], [/trip|여행/, "plane"], [/quote|인용/, "quote"], [/paint|art|그림/, "palette"],
  [/note|노트|메모/, "sticky-note"], [/daily|journal|일기/, "calendar-days"], [/ml|ai|model|agent/, "brain"],
  [/data|analy|분석/, "chart-bar"], [/code|engineer|개발/, "code"], [/survey|research|연구/, "flask-conical"],
  [/benchmark/, "gauge"], [/architecture/, "building-2"], [/template|템플릿/, "layout-template"],
  [/email|mail/, "mail"], [/post|blog/, "newspaper"], [/law|legal/, "scale"], [/house|home/, "home"],
  [/collection|list/, "library"], [/file/, "file"], [/portfolio/, "briefcase"], [/checklist|체크/, "list-checks"],
];

const THUMB_KEYS = ["cover", "banner", "image", "thumbnail", "photo", "poster"];
const HIDDEN_SUBTITLE_KEYS = ["tags", "tag", "aliases", "alias", "cssclasses", "cssclass", "collections", "created", "modified", "updated", "date created", "date modified", ...THUMB_KEYS];
const IMG_EXT = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];
const DOC_EXT = ["pdf", "docx", "doc", "xlsx", "xls", "csv", "pptx", "ppt", "hwp", "hwpx", "txt", "epub", "key", "pages", "numbers"];
const FILE_COLLECTIONS = [
  { key: "file:images", label: "Images", icon: "image", color: "#32ADE6", ext: IMG_EXT },
  { key: "file:pdfs", label: "PDFs", icon: "file-text", color: "#FF3B30", ext: ["pdf"] },
  { key: "file:videos", label: "Videos", icon: "film", color: "#5856D6", ext: ["mp4", "mov", "webm", "mkv", "ogv"] },
  { key: "file:audio", label: "Audio", icon: "audio-lines", color: "#FF9500", ext: ["mp3", "wav", "m4a", "ogg", "flac", "3gp"] },
  { key: "file:tags", label: "Tags", icon: "tags", color: "#8E8E93", ext: [] },
];
const SMART = [
  { key: "smart:home", label: "Home", icon: "house" },
  { key: "smart:inbox", label: "Inbox", icon: "inbox" },
  { key: "smart:calendar", label: "Calendar", icon: "calendar" },
  { key: "smart:tasks", label: "Tasks", icon: "circle-check" },
];


/** the sidebar Tasks panel's starting views (users can rename, re-icon, re-filter, add and delete them) */
const DEFAULT_TASK_VIEWS = [
  { id: "today", name: "Today", icon: "sun", layout: "today", filter: { scope: "all", tags: [], status: "open", date: "any" } },
  { id: "week", name: "Week", icon: "calendar-range", layout: "week", filter: { scope: "all", tags: [], status: "open", date: "any" } },
  { id: "month", name: "Month", icon: "calendar", layout: "month", filter: { scope: "all", tags: [], status: "open", date: "any" } },
  { id: "all", name: "All", icon: "list-checks", layout: "list", filter: { scope: "all", tags: [], status: "open", date: "any" } },
];

/* first-run mapping of this vault's existing types to folders */
const FOLDER_TYPE_SEED = {}; // first-run mapping of existing `type` values to folders (empty in the public release)

/** optional plugins Typefold integrates with (✦ = made by the same author) */
const COMPANIONS = [
  { id: "extended-base", name: "Extended Base", mine: true, why: "Notion-style Board / List / Feed views for type pages and folder boards. Without it, pages use the core Table and Cards views." },
  { id: "folder-notes", name: "Folder notes", why: "Clicking a folder opens its folder note, and new folders get a board page." },
  { id: "obsidian-icon-folder", name: "Iconize", why: "Use Iconize's icons (Font Awesome, Boxicons, emoji…) in the panel and keep both in sync." },
  { id: "notion-style-comments", name: "Notion-style Comments", mine: true, why: "Notion-like margin comments that match this look." },
  { id: "notion-selection-toolbar", name: "Notion Selection Toolbar", mine: true, why: "A floating formatting toolbar in the same style." },
];

const DEFAULT_SETTINGS = {
  property: "type",
  minCount: 1,
  sortTypes: "manual",
  typeOrder: [],
  expanded: {},
  openBaseOnClick: true,
  basesFolder: "Typefold",
  sortNotes: "modified",
  listMode: "list",
  showFiles: true,
  showFavorites: true,
  showSmart: true,
  showCounts: false,
  defaultFolder: "",
  navWidth: 230,
  hideProperties: true,
  showBanner: true,
  showRelated: true,
  linkIcons: true,
  themeTweaks: true,
  autoFolderNotes: true,
  devAutoReload: false,
  autoReveal: true,
  viewTabs: true,
  iconize: "sync", // "sync" = show Iconize icons and write icon changes back; "ignore"
  replaceExplorer: false,
  smartItems: ["smart:home", "smart:inbox", "smart:calendar", "smart:tasks"],
  showRecents: true, recentsCount: 7, closedSections: {}, // sidebar sections: Favorites / Recents folded?
  recentFiles: [], // most recently opened first (Recents)
  taskViews: {}, // scope ("all" or a type key) -> { mode: "month"|"week"|"day"|"list", bg: { image }|{ color }|null }
  taskShowDone: false,
  taskPanelViews: null, // sidebar Tasks views; null = DEFAULT_TASK_VIEWS
  taskPanelView: "today",
  // on/off switches (true = shown)
  showNoteChips: true, showPageIcons: true, showStatusBar: true, showRibbon: true, showNavFooter: true,
  showNavTop: true, homeGreeting: true, homeTypes: true, homePinned: true, homeRecent: true,
  showWhatsNew: true, lastSeenVersion: "",
  useFolderNotes: true, // off: Typefold ignores folder notes entirely (no opening, headers or creating)
  oneFolderOpen: false,
  hideIconizeOnTypePages: false, // hide Iconize's big title icon on type pages
  iconizeHintDismissed: false, // opening a folder closes the others (except the folders it sits in)
  splitCalendarTasks: false, // false = one Calendar row with a Daily notes tab and the task tabs
  taskSource: "", // "tasknotes" | "tasks" (Tasks plugin) | "checkbox" (`- [ ]` in notes); "" = pick on first load
  homeMode: "typefold", // "typefold" = built-in Home dashboard, "note" = the note in homeNote
  homeNote: "",
  openHomeOnStartup: true,
  newTabSearch: true,
  userName: "",
  showWeather: false,
  weatherPlace: "",
  weatherLat: null,
  weatherLon: null,
  home: { recentView: "list", recentCount: 12, typeNotes: 3, showTypeChips: true },
  pinned: [], // { kind: "type"|"note", id }
  types: {},
};

function hashColor(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return COLORS[Math.abs(h) % (COLORS.length - 1)].hex;
}
function cleanLink(v) {
  return String(v).trim().replace(/^!?\[\[(.*?)(\|.*)?\]\]$/, "$1").replace(/^#/, "");
}
function typeValues(raw) {
  const out = [];
  for (const v of Array.isArray(raw) ? raw : [raw]) {
    if (v == null || typeof v === "object") continue;
    const s = cleanLink(v);
    if (s) out.push(s);
  }
  return out;
}
function paintIcon(el, icon, color) {
  el.empty();
  el.addClass("ot-icon");
  el.style.setProperty("--ot-color", color);
  setIcon(el, icon);
  return el;
}
function relTime(ts) {
  const d = moment(ts), now = moment();
  if (d.isSame(now, "day")) return d.format("HH:mm");
  if (d.isSame(now.clone().subtract(1, "day"), "day")) return "Yesterday";
  if (now.diff(d, "days") < 7) return d.format("dddd");
  return d.format(d.isSame(now, "year") ? "MMM D" : "MMM D, YYYY");
}
function groupLabel(ts) {
  const d = moment(ts), now = moment();
  if (d.isSame(now, "day")) return "Today";
  if (d.isSame(now.clone().subtract(1, "day"), "day")) return "Yesterday";
  if (now.diff(d, "days") < 7) return "Previous 7 days";
  if (now.diff(d, "days") < 30) return "Previous 30 days";
  return d.format(d.isSame(now, "year") ? "MMMM" : "MMMM YYYY");
}

/* ───────────────────────────── Plugin ───────────────────────────── */

class TypefoldPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.types ||= {};
    this.settings.pinned ||= [];
    this.migrateToFolderTypes();
    this.migrateV2();
    this.index = new Map(); // typeKey -> { label, files }
    this.fileType = new Map(); // path -> typeKey
    this.backlinkCache = null;
    this.propsVisible = !this.settings.hideProperties;

    ICONIZE_API = () => this.app.plugins?.plugins?.["obsidian-icon-folder"]?.api || null;
    // a load that failed half-way never unloads, so clear what it registered or this load throws "already registered"
    for (const t of [VIEW_TYPE, HOME_VIEW, TASKS_VIEW]) { try { if (this.app.viewRegistry?.viewByType?.[t]) this.app.viewRegistry.unregisterView(t); } catch (e) {} }
    try { require("obsidian").MarkdownPreviewRenderer?.unregisterCodeBlockPostProcessor?.("typefold-home"); } catch (e) {}
    this.registerView(VIEW_TYPE, (leaf) => new TypefoldView(leaf, this));
    this.registerView(HOME_VIEW, (leaf) => new HomeView(leaf, this));
    this.registerView(TASKS_VIEW, (leaf) => new TasksView(leaf, this));
    // the Tasks row was hidden by default before; show it once for existing vaults
    if (Array.isArray(this.settings.smartItems)) this.settings.smartItems = this.settings.smartItems.filter((k) => k !== "smart:recent");
    if (!this.settings.taskSource) {
      const has = (id) => !!this.app.plugins?.enabledPlugins?.has?.(id);
      this.settings.taskSource = this.settings.useTaskNotes === false ? "checkbox"
        : has("tasknotes") ? "tasknotes" : has("obsidian-tasks-plugin") ? "tasks" : "checkbox";
    }
    if (!this.settings.recentRowShown) {
      this.settings.recentRowShown = true;
      const items = this.settings.smartItems;
      if (Array.isArray(items)) this.settings.smartItems = items.filter((k) => k !== "smart:recent"); // Recents is a section now
      if (!(this.settings.recentFiles || []).length) this.settings.recentFiles = (this.app.workspace.getLastOpenFiles?.() || []).slice(0, 60);
    }
    if (!this.settings.tasksRowShown) {
      this.settings.tasksRowShown = true;
      if (Array.isArray(this.settings.smartItems) && !this.settings.smartItems.includes("smart:tasks")) this.settings.smartItems.push("smart:tasks");
      this.saveData(this.settings);
    }
    this.addCommand({ id: "open-tasks", name: "Open tasks", callback: () => this.openTasks() });
    this.addCommand({ id: "whats-new", name: "Show what's new and the guide", callback: () => new WhatsNewModal(this, "new").open() });
    // ```typefold-home``` in any note draws the Home dashboard there (e.g. a Home.md)
    this.homeEmbeds = new Set();
    this.registerMarkdownCodeBlockProcessor("typefold-home", (src, el, ctx) => ctx.addChild(new HomeEmbed(el, this)));
    this.addRibbonIcon("house", "Home", () => this.openHome()).addClass("ot-ribbon");
    this.addCommand({ id: "open-home", name: "Open home dashboard", callback: () => this.openHome() });
    this.addCommand({ id: "quick-open", name: "Search and open a page…", callback: () => new QuickOpenModal(this, null).open() });
    this.addCommand({ id: "reveal-file", name: "Reveal current file in navigator", callback: () => this.revealFile(this.app.workspace.getActiveFile()) });
    this.addCommand({ id: "toggle-default-explorer", name: "Toggle: use as default file explorer", callback: async () => {
      this.settings.replaceExplorer = !this.settings.replaceExplorer;
      await this.saveSettings(false);
      new Notice(this.settings.replaceExplorer ? "Typefold is now your file explorer." : "Core file explorer restored.");
    } });
    this.addRibbonIcon("shapes", "Typefold", () => this.activateView()).addClass("ot-ribbon");
    this.addCommand({ id: "open-sidebar", name: "Open object types navigator", callback: () => this.activateView() });
    this.addCommand({ id: "new-object", name: "Create new object…", callback: () => this.newObjectFlow() });
    this.addCommand({ id: "new-type", name: "Create new object type…", callback: () => new NewTypeModal(this).open() });
    this.addCommand({ id: "edit-type", name: "Edit object type…", callback: () => new TypePickerModal(this, (key) => new TypeConfigModal(this, key).open()).open() });
    this.addCommand({ id: "toggle-properties", name: "Toggle properties in object notes", callback: () => this.toggleProps() });
    this.addSettingTab(new TypefoldSettingTab(this.app, this));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("ot-status");

    this.requestRebuild = debounce(() => this.rebuild(), 300, true);
    this.requestDecorate = debounce(() => this.decorateAll(), 150, true);
    const soft = debounce(() => this.softRefresh(), 900, true);
    this.registerEvent(this.app.metadataCache.on("changed", () => soft()));
    // TaskNotes updates its cache right after the metadata cache; give it a moment
    const tasksSoft = debounce(() => this.refreshTasks(), 500, true);
    this.registerEvent(this.app.metadataCache.on("changed", () => {
      if (this.app.workspace.getLeavesOfType(TASKS_VIEW).length || this.app.workspace.getLeavesOfType(VIEW_TYPE).some((l) => ["smart:tasks", "smart:calendar"].includes(l.view?.selected))) tasksSoft();
    }));
    this.registerEvent(this.app.vault.on("delete", () => tasksSoft()));
    let firstResolve = true;
    this.registerEvent(this.app.metadataCache.on("resolved", () => {
      if (!firstResolve) return;
      firstResolve = false;
      this.requestRebuild();
      this.repairFolderBase().catch((e) => console.warn("Typefold: Folder.base", e));
      this.maybeShowWhatsNew();
    }));
    this.registerEvent(this.app.vault.on("create", () => this.requestRebuild()));
    this.registerEvent(this.app.vault.on("delete", (f) => {
      if (this.settings.defaultBanners?.[f.path]) { delete this.settings.defaultBanners[f.path]; this.saveData(this.settings); }
      this.requestRebuild();
    }));
    // Home redraws only while it's on screen; a hidden Home is marked and redrawn when shown again
    const refreshHome = debounce(() => this.app.workspace.getLeavesOfType(HOME_VIEW).forEach((l) => {
      if (l.view?.containerEl?.isShown?.() === false) { if (l.view) l.view._stale = true; return; }
      l.view?.render?.();
    }), 1500, true);
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      if (leaf?.view?._stale && leaf.view.getViewType?.() === HOME_VIEW) { leaf.view._stale = false; leaf.view.render(); }
    }));
    this.registerEvent(this.app.vault.on("modify", () => refreshHome()));
    this.registerEvent(this.app.vault.on("rename", (f, old) => { this.renamePinned(old, f.path); this.requestRebuild(); }));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      // draw the opened note's header right away; the debounced pass only touches views that changed
      const v = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (v && v.file === file) this.decorate(v);
      this.requestDecorate(); this.refreshViews(true); this.autoReveal(file); this.noteRecent(file);
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.requestDecorate()));
    // hide Obsidian's vault bar while the navigator is the visible left-sidebar tab (our footer replaces it)
    const navShown = () => {
      const ws = this.app.workspace;
      document.body.toggleClass("ot-nav-shown", ws.getLeavesOfType(VIEW_TYPE)
        .some((l) => l.getRoot?.() === ws.leftSplit && l.containerEl?.style.display !== "none"));
    };
    this.registerEvent(this.app.workspace.on("layout-change", navShown));
    this.registerEvent(this.app.workspace.on("active-leaf-change", navShown));
    this.app.workspace.onLayoutReady(navShown);
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.requestDecorate()));
    // default-explorer mode: if something shows the core File explorer, show this panel instead
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      if (!this.settings.replaceExplorer) return;
      const fe = this.app.workspace.getLeavesOfType("file-explorer")[0];
      const ours = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (fe && ours && fe.view?.containerEl?.isShown?.() && fe.parent === ours.parent) this.app.workspace.revealLeaf(ours);
    }));

    this.registerEditorExtension(this.linkIconExtension());
    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      if (!(file instanceof TFolder) || file.path === "/") return;
      const owner = Object.keys(this.settings.types).find((k) => this.typeFolders(k).includes(file.path));
      menu.addItem((i) => i.setTitle(owner ? `Object type: ${this.labelFor(owner)}` : "Register as object type…")
        .setIcon("shapes").onClick(() => owner
          ? this.activateView().then(() => this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view?.select(owner))
          : new NewTypeModal(this, { folder: file.path, label: file.name }).open()));
    }));
    this.registerMarkdownPostProcessor((el, ctx) => {
      if (this.settings.linkIcons) this.addLinkIconsToDom(el, ctx.sourcePath);
      this.requestDecorate();
    });

    this.applyBodyClasses();
    if (this.settings.devAutoReload) this.watchOwnFiles();
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on("create", (f) => { if (f instanceof TFolder) this.onFolderCreated(f); }));
      this.setupViewTabs();
      const bmi = this.app.internalPlugins?.getPluginById?.("bookmarks")?.instance;
      if (bmi?.on) this.registerEvent(bmi.on("changed", () => this.refreshViews()));
      this.rebuild();
      this.cleanupLeaves();
      setTimeout(() => this.cleanupLeaves(), 1200);
      setTimeout(() => this.cleanupLeaves(), 4000);
      if (this.settings.replaceExplorer) {
        const ours = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
        // show this panel instead of the file explorer (without opening a collapsed sidebar)
        if (ours && !this.app.workspace.leftSplit?.collapsed) this.app.workspace.revealLeaf(ours);
      }
      // tabs restored before this plugin loaded show their raw view id until loaded
      this.app.workspace.iterateAllLeaves((l) => {
        if (l.getViewState?.().type !== HOME_VIEW) return;
        if (l.view instanceof HomeView) return;
        if (l.isDeferred) l.loadIfDeferred?.();
        else if (l.rebuildView) l.rebuildView(); // re-attach a Home tab left over from a previous load
        else l.setViewState(l.getViewState());
      });
      if (this.settings.openHomeOnStartup && !this._startedOnce) {
        this._startedOnce = true;
        const existing = this.homeLeaf();
        if (existing) this.app.workspace.setActiveLeaf(existing, { focus: true });
        else {
          const root = this.app.workspace.getMostRecentLeaf?.(this.app.workspace.rootSplit);
          this.openHome(!(root && root.view?.getViewType?.() === "empty"));
        }
      }
      // every empty leaf that exists now isn't "new"; only tabs opened from here on get the search panel
      this._seenLeaves = new WeakSet();
      this.app.workspace.iterateAllLeaves((l) => this._seenLeaves.add(l));
      this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => this.onLeafActive(leaf)));
      this.hookNewTabCommand();
      if (!this.settings.welcomed) {
        this.settings.welcomed = true;
        this.saveData(this.settings);
        const missing = COMPANIONS.slice(0, 3).filter((c) => !this.app.plugins?.enabledPlugins?.has(c.id)).map((c) => c.name);
        new Notice(`Typefold is ready — right-click a folder in the file explorer → “Register as object type…”.${missing.length ? `\nWorks even better with: ${missing.join(", ")} (see settings).` : ""}`, 12000);
      }
    });
  }

  /** reload this plugin automatically when its main.js or styles.css changes on disk */
  watchOwnFiles() {
    const files = ["main.js", "styles.css"].map((f) => `${this.manifest.dir}/${f}`);
    const stamp = async () => (await Promise.all(files.map((f) => this.app.vault.adapter.stat(f)))).map((s) => s?.mtime || 0).join(",");
    stamp().then((initial) => {
      this.registerInterval(window.setInterval(async () => {
        const plugins = this.app.plugins, id = this.manifest.id;
        if (plugins.plugins[id] !== this || !this._loaded) return; // a replaced copy must not keep reloading the live one
        if ((await stamp()) === initial) return;
        if (this._reloading) return;
        this._reloading = true;
        await plugins.disablePlugin(id);
        await plugins.enablePlugin(id);
      }, 2500));
    });
  }

  onunload() {
    for (const m of [...OPEN_MODALS]) { try { m.close(); } catch (e) {} }
    OPEN_MODALS.clear();
    document.body.removeClass("ot-theme", "ot-hide-props", "ot-replace-explorer", "ot-nav-shown");
    if (this.settings) { this.settings.replaceExplorer = false; this.applyExplorerMode(); }
    document.querySelectorAll(".ot-note-header, .ot-related").forEach((el) => el.remove());
    document.querySelectorAll(".ot-object-note").forEach((el) => el.removeClass("ot-object-note"));
  }

  async onExternalSettingsChange() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.settings.types ||= {};
    this.settings.pinned ||= [];
    this.applyBodyClasses();
    this.rebuild();
    this.syncViewTabs?.();
  }

  migrateToFolderTypes() {
    const st = this.settings;
    if (st.folderTypesV >= 1) return;
    for (const [key, seed] of Object.entries(FOLDER_TYPE_SEED)) {
      const c = (st.types[key] ||= {});
      c.label ||= seed.label;
      c.folders = [...new Set([...(c.folders || []), ...(c.folder ? [c.folder] : []), ...seed.folders])];
      c.registered = true;
      delete c.folder;
    }
    for (const c of Object.values(st.types)) {
      if (c.folder) { c.folders = [...new Set([...(c.folders || []), c.folder])]; delete c.folder; }
    }
    st.folderTypesV = 1;
    this.saveData(st);
  }

  migrateV2() {
    const st = this.settings;
    if (st.folderTypesV >= 2) return;
    const t = st.types.tags;
    if (t && (t.folders || []).length === 1 && normalizePath(t.folders[0]) === "Tags") {
      delete st.types.tags;
      st.typeOrder = (st.typeOrder || []).filter((k) => k !== "tags");
    }
    st.folderTypesV = 2;
    this.saveData(st);
  }

  /** folders a type is defined by */
  typeFolders(key) { return (this.settings.types[key]?.folders || []).map((f) => normalizePath(f)); }

  async saveSettings(rebuild = true) {
    this.bumpDeco();
    await this.saveData(this.settings);
    this.applyBodyClasses();
    if (rebuild) this.rebuild();
  }

  /** exactly one navigator panel: keep the live one, re-attach or drop leftovers from earlier loads */
  cleanupLeaves() {
    // tabs saved under the old plugin id: turn them into this plugin's views
    this.app.workspace.iterateAllLeaves((l) => {
      const st = l.getViewState?.();
      if (st && LEGACY_VIEWS[st.type]) l.setViewState({ ...st, type: LEGACY_VIEWS[st.type] });
    });
    const ours = [];
    this.app.workspace.iterateAllLeaves((l) => { if (l.getViewState?.().type === VIEW_TYPE) ours.push(l); });
    ours.sort((a, b) => (b.view instanceof TypefoldView) - (a.view instanceof TypefoldView));
    ours.slice(1).forEach((l) => l.detach());
    const keep = ours[0];
    if (keep && !(keep.view instanceof TypefoldView)) keep.setViewState(keep.getViewState());
    if (!keep) this.activateView(false);
    else if (this.settings.replaceExplorer && !this.app.workspace.leftSplit?.collapsed && keep.view instanceof TypefoldView && !this._revealedOnce) {
      this._revealedOnce = true;
      this.app.workspace.revealLeaf(keep);
    }
  }

  /* ── view tabs for Bases (standalone .base files and bases embedded in notes) ── */
  setupViewTabs() {
    this._tabControllers = new Set();
    this._ctrlFile = new WeakMap();
    const reg = this.app.embedRegistry;
    const orig = reg?.embedByExtension?.base;
    if (orig && !orig.__otWrapped) {
      const plugin = this;
      const wrapped = function (...args) {
        const comp = orig.apply(this, args);
        if (comp?.controller) {
          plugin._tabControllers.add(comp.controller);
          if (comp.file?.path) plugin._ctrlFile.set(comp.controller, comp.file.path);
          setTimeout(() => plugin.syncViewTabs(), 60);
        }
        return comp;
      };
      wrapped.__otWrapped = true;
      reg.embedByExtension.base = wrapped;
      this.register(() => { if (reg.embedByExtension.base === wrapped) reg.embedByExtension.base = orig; });
    }
    const sync = debounce(() => this.syncViewTabs(), 80, true);
    this.registerEvent(this.app.workspace.on("layout-change", sync));
    this.registerEvent(this.app.workspace.on("active-leaf-change", sync));
    this.registerEvent(this.app.workspace.on("file-open", sync));
    this.registerEvent(this.app.vault.on("modify", (f) => { if (f.extension === "base") setTimeout(sync, 150); }));
    this.register(() => {
      document.querySelectorAll(".ot-view-tabs").forEach((e) => e.remove());
      document.querySelectorAll(".ot-has-view-tabs").forEach((e) => e.removeClass("ot-has-view-tabs"));
    });
    // embeds already on screen were created before the hook: redraw visible notes that contain a base once
    for (const l of this.app.workspace.getLeavesOfType("markdown")) {
      if (l.view?.containerEl?.isShown?.() && l.view.contentEl.querySelector(".bases-embed")) l.rebuildView?.();
    }
    // tabs are built in now: switch off the separate View Tabs plugin so there's one tab bar
    const other = "view-tabs-for-bases";
    if (this.settings.viewTabs && this.app.plugins?.enabledPlugins?.has(other)) {
      this.app.plugins.disablePluginAndSave(other).then(() => new Notice("View tabs are now built into Typefold — turned off “View Tabs for Bases”."));
    }
    sync();
  }

  syncViewTabs() {
    if (!this.settings.viewTabs) { document.querySelectorAll(".ot-view-tabs").forEach((e) => e.remove()); return; }
    const ctrls = new Set();
    for (const l of this.app.workspace.getLeavesOfType("bases")) if (l.view?.controller) {
      ctrls.add(l.view.controller);
      if (l.view.file?.path) this._ctrlFile.set(l.view.controller, l.view.file.path);
    }
    for (const c of this._tabControllers || []) {
      if (c.viewHeaderEl?.isConnected) ctrls.add(c); else this._tabControllers.delete(c);
    }
    for (const c of ctrls) this.renderViewTabs(c);
  }

  renderViewTabs(c) {
    let names = [];
    try { names = c.getQueryViewNames?.() || []; } catch (e) {}
    const toolbar = c.viewHeaderEl?.querySelector(".bases-toolbar");
    if (!toolbar) return;
    let bar = toolbar.querySelector(":scope > .ot-view-tabs");
    toolbar.toggleClass("ot-has-view-tabs", names.length >= 2);
    if (names.length < 2) { bar?.remove(); return; }
    if (!bar) {
      bar = createDiv("ot-view-tabs");
      bar.setAttr("role", "tablist");
      const count = toolbar.querySelector(".bases-toolbar-result-count");
      if (count) count.after(bar); else toolbar.prepend(bar); // right after "N results"
      if (!c.__otTabsHooked && c.events?.on) {
        c.__otTabsHooked = true;
        c.events.on("view-changed", () => this.renderViewTabs(c));
      }
    }
    const basePath = this._ctrlFile?.get(c) || "";
    const styles = this.settings.tabStyles?.[basePath] || {};
    const sig = names.join("\u0000") + "|" + c.viewName + "|" + JSON.stringify(styles);
    if (bar.dataset.sig === sig) return;
    bar.dataset.sig = sig;
    bar.empty();
    const views = c.query?.views || [];
    for (const name of names) {
      const tab = bar.createDiv("ot-view-tab" + (name === c.viewName ? " is-active" : ""));
      tab.setAttr("role", "tab"); tab.setAttr("aria-selected", String(name === c.viewName)); tab.setAttr("tabindex", "0");
      tab.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tab.click(); } };
      const v = views.find((x) => x.name === name);
      let icon = null;
      try { icon = c.plugin?.getRegistration?.(v?.type)?.icon; } catch (e) {}
      const st = styles[name] || {};
      if (st.icon) icon = st.icon;
      if (st.color && st.color !== NO_COLOR) { tab.addClass("has-color"); tab.style.setProperty("--tab-color", st.color); }
      if (icon) setIcon(tab.createSpan("ot-view-tab-icon"), icon.replace(/^lucide-/, ""));
      tab.createSpan({ text: name });
      tab.onclick = () => { try { c.selectView(name); } catch (e) {} this.renderViewTabs(c); };
      tab.oncontextmenu = (evt) => {
        evt.preventDefault();
        if (!basePath) return;
        const m = new Menu();
        m.addItem((i) => i.setTitle("Icon & color…").setIcon("palette").onClick(() => new IconColorModal(this, {
          title: `Tab “${name}”`, icon: st.icon || (icon || "table").replace(/^lucide-/, ""), color: st.color || NO_COLOR,
          onSave: (ic, col) => this.setTabStyle(basePath, name, { icon: ic, color: col }),
          onRemove: (st.icon || st.color) ? () => this.setTabStyle(basePath, name, null) : null,
        }).open()));
        if (st.icon || st.color) m.addItem((i) => i.setTitle("Reset tab style").setIcon("rotate-ccw").onClick(() => this.setTabStyle(basePath, name, null)));
        m.showAtMouseEvent(evt);
      };
    }
  }

  async setTabStyle(basePath, viewName, style) {
    const all = (this.settings.tabStyles ||= {});
    const per = (all[basePath] ||= {});
    if (style) per[viewName] = style; else delete per[viewName];
    if (!Object.keys(per).length) delete all[basePath];
    await this.saveSettings(false);
    this.syncViewTabs();
  }

  onLeafActive(leaf) {
    if (!this.settings.newTabSearch || !leaf || this._qoOpen) return;
    if (leaf.view?.getViewType?.() !== "empty" || leaf.getRoot?.() !== this.app.workspace.rootSplit) return;
    new QuickOpenModal(this, leaf).open();
  }

  /** ⌘T / "New tab": open the tab and the search panel in one step */
  hookNewTabCommand() {
    const cmd = this.app.commands?.commands?.["workspace:new-tab"];
    if (!cmd || cmd.__otHooked) return;
    const orig = { callback: cmd.callback, checkCallback: cmd.checkCallback };
    cmd.__otHooked = true;
    cmd.checkCallback = undefined;
    cmd.callback = () => {
      if (!this.settings.newTabSearch) {
        if (orig.callback) return orig.callback();
        return orig.checkCallback?.(false);
      }
      const ws = this.app.workspace;
      const cur = ws.getMostRecentLeaf?.(ws.rootSplit);
      const leaf = cur && cur.view?.getViewType?.() === "empty" ? cur : ws.getLeaf("tab");
      this._qoOpen = true; // keep the leaf-change listener from opening a second panel
      ws.setActiveLeaf(leaf, { focus: false });
      new QuickOpenModal(this, leaf).open();
    };
    this.register(() => { cmd.callback = orig.callback; cmd.checkCallback = orig.checkCallback; delete cmd.__otHooked; });
  }

  isTemplate(f) {
    if (!this._tplFolders) {
      const a = this.app.internalPlugins?.getPluginById?.("templates")?.instance?.options?.folder;
      const b = this.app.plugins?.plugins?.["templater-obsidian"]?.settings?.templates_folder;
      this._tplFolders = [a, b].filter(Boolean).map((x) => normalizePath(x) + "/");
    }
    return this._tplFolders.some((t) => f.path.startsWith(t));
  }

  /** open a note from the panel / Home; on a phone, close the sidebar drawer so the note is visible */
  openFromPanel(file, evt) {
    const p = this.app.workspace.getLeaf(evt ? Keymap.isModEvent(evt) : false).openFile(file);
    if (Platform.isPhone) this.app.workspace.leftSplit?.collapse?.();
    return p;
  }

  /* ── note icons ── */
  noteIcon(file) {
    const iz = this.iconizeInfo(file.path);
    if (iz) return { iconize: iz };
    const own = this.settings.noteIcons?.[file.path];
    return own ? { own } : null;
  }
  async setNoteIcon(file, icon, color) {
    if (this.iconizePlugin()) {
      await this.writeIconize(file.path, icon, color);
      if (this.settings.noteIcons?.[file.path]) { delete this.settings.noteIcons[file.path]; await this.saveSettings(false); }
    } else {
      this.settings.noteIcons ||= {};
      if (icon) this.settings.noteIcons[file.path] = { icon, color };
      else delete this.settings.noteIcons[file.path];
      await this.saveSettings(false);
    }
    this.afterIconChange(file);
  }
  afterIconChange(file) {
    this.bumpDeco();
    this._linkInfo = new Map();
    this.app.workspace.trigger("file-open", file); // Iconize redraws its title icon on file-open
    this.refreshViews();
    this.decorateAll();
  }

  /* ── Iconize integration ── */
  iconizePlugin() {
    if (this.settings.iconize === "ignore") return null;
    const pl = this.app.plugins?.plugins?.["obsidian-icon-folder"];
    return pl?.data && pl.api ? pl : null;
  }
  /** the Iconize custom rule that gives this file an icon above its title (null if none, or set by hand) */
  iconizeRuleFor(file) {
    const pl = this.app.plugins?.plugins?.["obsidian-icon-folder"];
    const st = pl?.data?.settings;
    if (!file || !st || !st.iconInTitleEnabled || pl.data[file.path]) return null;
    for (const r of st.rules || []) {
      if (!r?.rule || (r.for && r.for !== "everything" && r.for !== "files")) continue;
      let hit = false;
      try { hit = new RegExp(r.rule).test(file.basename); } catch (e) { hit = file.basename.includes(r.rule); }
      if (hit) return r;
    }
    return null;
  }
  iconizeInfo(path) {
    const pl = this.iconizePlugin();
    const v = pl?.data?.[path];
    if (!v || path === "settings") return null;
    return typeof v === "object" ? { name: v.iconName, color: v.iconColor } : { name: v };
  }
  /** draw an Iconize icon (any pack or emoji) into el; false if it couldn't */
  drawIconize(el, info) {
    const pl = this.iconizePlugin();
    if (!pl || !info?.name) return false;
    const k = info.name + "|" + (info.color || "");
    const cached = SVG_CACHE.get(k);
    if (cached != null) el.innerHTML = cached;
    else {
      try { el.empty(); pl.api.setIconForNode(info.name, el, info.color); SVG_CACHE.set(k, el.innerHTML); } catch (e) { return false; }
    }
    el.addClass("ot-iconize");
    return !!el.firstChild || !!el.textContent;
  }
  static lucideToIconize(id) { return "Li" + id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(""); }
  static iconizeToLucide(name) {
    if (!name?.startsWith("Li")) return null;
    return name.slice(2).replace(/([a-z0-9])([A-Z])/g, "$1-$2").replace(/([A-Za-z])([0-9])/g, "$1-$2").toLowerCase();
  }
  async writeIconize(path, lucideIcon, color) {
    const pl = this.iconizePlugin();
    if (!pl || !path) return;
    try {
      if (!lucideIcon) { pl.removeFolderIcon?.(path); delete pl.data[path]; }
      else {
        const name = /^[A-Z]/.test(lucideIcon) ? lucideIcon : TypefoldPlugin.lucideToIconize(lucideIcon);
        const realColor = color && !String(color).startsWith("var(") ? color : null;
        pl.data[path] = realColor ? { iconName: name, iconColor: realColor } : name;
      }
      await pl.saveIconFolderData();
    } catch (e) { console.warn("[typefold] Iconize write failed", e); }
  }

  /* ── act as the default file explorer ── */
  applyExplorerMode() {
    const on = !!this.settings.replaceExplorer;
    document.body.toggleClass("ot-replace-explorer", on);
    const cmds = this.app.commands?.commands || {};
    this._origCmds ||= {};
    const patch = (id, fn) => {
      const c = cmds[id];
      if (!c) return;
      if (!this._origCmds[id]) this._origCmds[id] = { callback: c.callback, checkCallback: c.checkCallback };
      if (on) { c.checkCallback = undefined; c.callback = fn; }
      else { c.callback = this._origCmds[id].callback; c.checkCallback = this._origCmds[id].checkCallback; }
    };
    patch("file-explorer:open", () => this.activateView());
    // breadcrumbs in the note title bar, "Reveal in folder", etc. all go through File explorer's revealInFolder
    const fe = this.app.internalPlugins?.getPluginById?.("file-explorer")?.instance;
    if (fe) {
      if (!this._origReveal) this._origReveal = fe.revealInFolder;
      fe.revealInFolder = on ? (af) => this.revealPath(af) : this._origReveal;
    }
    patch("file-explorer:reveal-active-file", () => this.revealFile(this.app.workspace.getActiveFile()));
  }

  /** follow the opened note in the panel (breadcrumbs, links, search, quick switcher…) */
  autoReveal(file) {
    if (!this.settings.autoReveal || !file || this._revealing) return;
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (!(view instanceof TypefoldView)) return;
    const fnFolder = this.folderOfFolderNote(file);
    if (fnFolder) return this.quietReveal(view, fnFolder.path);
    if (view.selected && this.filesFor(view.selected).includes(file)) { // already in the list: just open its folder in the tree
      if (this.expandTo(file.parent?.path)) { this.saveData(this.settings); view.render(); }
      return view.markActive();
    }
    if (file.parent) this.quietReveal(view, file.parent.path, file);
  }

  /** the panel key for a folder inside a registered type (the type itself for its root), or null */
  folderSelectKey(path) {
    let best = null, bestLen = -1;
    for (const k of Object.keys(this.settings.types)) {
      if (k.includes(":") || !this.settings.types[k].registered || this.settings.types[k].hidden) continue;
      for (const f of this.typeFolders(k)) if ((path === f || path.startsWith(f + "/")) && f.length > bestLen) { best = k; bestLen = f.length; }
    }
    if (!best) return null;
    return path === this.typeRoot(best) ? best : this.folderKey(best, path);
  }

  /** expand the tree down to (and including) a folder; returns true if anything changed */
  /** “One folder open at a time”: close every open type/folder except this one and the folders above it */
  collapseOthers(typeKey, path) {
    if (!this.settings.oneFolderOpen) return;
    const ex = this.settings.expanded || {};
    for (const k of Object.keys(ex)) {
      if (k.includes(":") && !k.startsWith("fold:")) continue; // tags, archive, … aren't folders
      if (k === typeKey) continue;
      const fk = this.parseFolderKey(k);
      if (fk && fk.type === typeKey && path && (path === fk.path || path.startsWith(fk.path + "/"))) continue;
      delete ex[k];
    }
  }

  expandTo(path) {
    if (!path) return false;
    let best = null, bestLen = -1;
    for (const k of Object.keys(this.settings.types)) {
      if (k.includes(":") || !this.settings.types[k].registered || this.settings.types[k].hidden) continue;
      for (const f of this.typeFolders(k)) if ((path === f || path.startsWith(f + "/")) && f.length > bestLen) { best = k; bestLen = f.length; }
    }
    if (!best) return false;
    const root = this.typeRoot(best);
    this.collapseOthers(best, path);
    let changed = false;
    const open = (k) => { if (!this.settings.expanded[k]) { this.settings.expanded[k] = true; changed = true; } };
    open(best);
    let cur = path;
    while (cur && cur !== root && (!root || cur.startsWith(root))) {
      open(this.folderKey(best, cur));
      if (!cur.includes("/")) break;
      cur = cur.split("/").slice(0, -1).join("/");
    }
    return changed;
  }

  /** select a folder in the panel without opening pages or forcing the sidebar open */
  quietReveal(view, path, file) {
    let best = null, bestLen = -1;
    for (const k of Object.keys(this.settings.types)) {
      if (k.includes(":") || !this.settings.types[k].registered || this.settings.types[k].hidden) continue;
      for (const f of this.typeFolders(k)) if ((path === f || path.startsWith(f + "/")) && f.length > bestLen) { best = k; bestLen = f.length; }
    }
    if (!best) return;
    const root = this.typeRoot(best);
    const key = path === root ? best : this.folderKey(best, path);
    if (view.selected === key) return view.markActive();
    this.collapseOthers(best, path);
    this.settings.expanded[best] = true;
    let cur = path;
    while (cur.includes("/") && cur !== root) {
      cur = cur.split("/").slice(0, -1).join("/");
      if (cur && cur !== root && (!root || cur.startsWith(root))) this.settings.expanded[this.folderKey(best, cur)] = true;
    }
    if (file) this.expandTo(path);
    this._revealing = true;
    view.select(key, { noOpen: true });
    this._revealing = false;
    this.saveData(this.settings);
    if (file) setTimeout(() => view.contentEl.querySelectorAll(`[data-path="${CSS.escape(file.path)}"]`).forEach((el) => el.scrollIntoView({ block: "nearest" })), 30);
  }

  /** open a folder (or a file's folder) in the navigator */
  async revealPath(af) {
    if (!af) return;
    if (af.extension) return this.revealFile(af);
    const path = af.path;
    // the most specific type whose folders contain this folder
    let best = null, bestLen = -1;
    for (const k of Object.keys(this.settings.types)) {
      if (k.includes(":") || !this.settings.types[k].registered) continue;
      for (const f of this.typeFolders(k)) {
        if ((path === f || path.startsWith(f + "/")) && f.length > bestLen) { best = { k, f }; bestLen = f.length; }
      }
    }
    await this.activateView();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (!view) return;
    if (!best) return; // folder outside every type: nothing to select
    const { k } = best;
    const root = this.typeRoot(k);
    let key = path === root ? k : this.folderKey(k, path);
    this.collapseOthers(k, path);
    this.settings.expanded[k] = true;
    let cur = path;
    while (cur.includes("/") && cur !== root) {
      cur = cur.split("/").slice(0, -1).join("/");
      if (cur && cur !== root && (!root || cur.startsWith(root))) this.settings.expanded[this.folderKey(k, cur)] = true;
    }
    await this.saveSettings(false);
    view.select(key, { noOpen: true });
  }

  /** select the active file's folder in the navigator and highlight it */
  async revealFile(file) {
    await this.activateView();
    const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (!view || !file) return;
    const tk = this.typeOfFile(file);
    let key = tk || "smart:inbox";
    if (tk && file.parent && file.parent.path !== this.typeRoot(tk) && file.parent.path !== "/") {
      key = this.folderKey(tk, file.parent.path);
      // open the tree down to that folder
      const root = this.typeRoot(tk);
      let cur = file.parent.path;
      this.collapseOthers(tk, file.parent.path);
      this.settings.expanded[tk] = true;
      while (cur && cur !== root && cur.includes("/")) {
        cur = cur.split("/").slice(0, -1).join("/");
        if (cur && cur !== root) this.settings.expanded[this.folderKey(tk, cur)] = true;
      }
    }
    await this.saveSettings(false);
    view.select(key, { noOpen: true });
    setTimeout(() => view.contentEl.querySelector(`.ot-item[data-path="${CSS.escape(file.path)}"]`)?.scrollIntoView({ block: "center" }), 50);
  }

  applyBodyClasses() {
    this.applyExplorerMode();
    document.body.toggleClass("ot-theme", this.settings.themeTweaks);
    document.body.toggleClass("ot-hide-props", !this.propsVisible);
    const s = this.settings;
    for (const [cls, on] of [["ot-no-chips", !s.showNoteChips], ["ot-no-page-icons", !s.showPageIcons], ["ot-no-status", !s.showStatusBar],
      ["ot-no-ribbon", !s.showRibbon], ["ot-no-navfoot", !s.showNavFooter], ["ot-no-navtop", !s.showNavTop],
      ["ot-hide-iz-typepages", !!s.hideIconizeOnTypePages],
      ["ot-home-no-greeting", !s.homeGreeting], ["ot-home-no-types", !s.homeTypes], ["ot-home-no-pinned", !s.homePinned], ["ot-home-no-recent", !s.homeRecent]])
      document.body.toggleClass(cls, !!on);
  }

  toggleProps() {
    this.propsVisible = !this.propsVisible;
    this.applyBodyClasses();
    this.updateStatus();
  }

  /* ── type data ── */
  get prop() { return this.settings.property.trim() || "type"; }
  conf(key) { return (this.settings.types[key] ||= {}); }
  special(key) { return FILE_COLLECTIONS.find((c) => c.key === key) || SMART.find((c) => c.key === key); }

  iconFor(key) {
    if (key === "smart:archive") return "archive";
    if (key?.startsWith("tag:")) return this.settings.types[key]?.icon || "hash";
    if (this.parseFolderKey(key)) return this.settings.types[key]?.icon || "folder";
    const c = this.settings.types[key];
    if (c?.icon) return c.icon;
    const sp = this.special(key);
    if (sp) return sp.icon;
    const label = this.labelFor(key).toLowerCase();
    for (const [re, icon] of ICON_GUESS) if (re.test(label)) return icon;
    return "box";
  }
  colorFor(key) {
    const fk = this.parseFolderKey(key);
    if (fk) return this.settings.types[key]?.color || this.colorFor(fk.type);
    if (key?.startsWith("tag:")) return this.settings.types[key]?.color || "#8E8E93";
    const c = this.settings.types[key];
    if (c?.color) return c.color;
    const sp = this.special(key);
    if (sp) return sp.color || "#8E8E93";
    return hashColor(key);
  }
  labelFor(key) {
    if (key === "smart:archive") return "Archive";
    if (key?.startsWith("tag:")) return "#" + key.slice(4);
    const fk = this.parseFolderKey(key);
    if (fk) return fk.path.split("/").pop();
    const sp = this.special(key);
    if (sp) return sp.label;
    return this.settings.types[key]?.label || this.index.get(key)?.label || key;
  }

  rebuild() {
    this.bumpDeco();
    // A note belongs to every registered type whose folder contains it (nested folders → several types).
    // Optionally a type also matches notes whose `type` property equals its name (matchProperty).
    const index = new Map(), fileTypes = new Map();
    const reg = Object.entries(this.settings.types).filter(([k, c]) => c.registered && !k.includes(":"));
    for (const [key, c] of reg) index.set(key, { label: c.label || key, files: [] });
    for (const file of this.app.vault.getMarkdownFiles()) {
      let fmVals = null;
      for (const [key, c] of reg) {
        let depth = -1;
        for (const f of this.typeFolders(key)) {
          if (file.path.startsWith(f + "/")) depth = Math.max(depth, f.split("/").length);
        }
        if (depth < 0 && c.matchProperty) {
          fmVals ||= typeValues(this.app.metadataCache.getFileCache(file)?.frontmatter?.[this.prop]).map((v) => v.toLowerCase());
          if (fmVals.includes((c.label || key).toLowerCase())) depth = 0;
        }
        if (depth < 0) continue;
        index.get(key).files.push(file);
        if (!fileTypes.has(file.path)) fileTypes.set(file.path, []);
        fileTypes.get(file.path).push({ key, depth });
      }
    }
    const fileType = new Map();
    for (const [path, list] of fileTypes) {
      list.sort((a, b) => b.depth - a.depth);
      fileType.set(path, list[0].key);
      fileTypes.set(path, list.map((x) => x.key));
    }
    this.index = index;
    this.fileType = fileType;
    this.fileTypes = fileTypes;
    this.clearCaches();
    this.refreshViews();
    this.decorateAll();
    let sig = 0;
    for (const [p, k] of fileType) for (let i = 0; i < p.length; i += 7) sig = (sig * 31 + p.charCodeAt(i) + k.length) | 0;
    sig = `${fileType.size}:${sig}`;
    if (sig !== this._typeSig) { this._typeSig = sig; this.app.workspace.updateOptions(); } // refresh CM link icons
  }

  /** a note's content/metadata changed: no need to re-index folders, just refresh what shows it */
  softRefresh() {
    this.bumpDeco();
    this._tagIndex = null; this.backlinkCache = null; this._linkInfo = new Map();
    if (Object.values(this.settings.types).some((c) => c.matchProperty)) return this.rebuild();
    this.refreshViews();
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active) this.decorate(active);
    this.updateStatus();
  }

  /** types listed under "Files" instead of "Object Types" (e.g. Templates) */
  isFilesSectionType(key) {
    const c = this.settings.types[key];
    if (c?.section) return c.section === "files";
    return key === "templates" || (c?.label || "").toLowerCase() === "templates";
  }

  visibleTypes(opts = {}) {
    const all = this._visibleTypes();
    if (opts.all) return all;
    return all.filter((t) => opts.files ? this.isFilesSectionType(t.key) : !this.isFilesSectionType(t.key));
  }

  _visibleTypes() {
    const out = [];
    for (const [key, entry] of this.index) {
      if (this.settings.types[key]?.hidden) continue;
      if (entry.files.length < this.settings.minCount && !this.settings.types[key]?.registered) continue;
      out.push({ key, label: this.labelFor(key), count: entry.files.length });
    }
    for (const [key, c] of Object.entries(this.settings.types)) {
      if (c.registered && !c.hidden && !this.index.has(key)) out.push({ key, label: this.labelFor(key), count: 0 });
    }
    if (this.settings.sortTypes === "count") out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    else if (this.settings.sortTypes === "manual") {
      const order = this.settings.typeOrder || [];
      const rank = (k) => { const i = order.indexOf(k); return i === -1 ? Infinity : i; };
      out.sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label));
    } else out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }

  filesFor(key) {
    if (key === "smart:archive") return this.archivedFiles();
    const out = this._filesFor(key).filter((f) => !this.isArchived(f.path));
    return key.startsWith("file:") || key === "smart:recent" ? out : out.filter((f) => !this.isFolderNote(f));
  }

  /** tag (without #) → notes, including notes of child tags */
  tagIndex() {
    if (this._tagIndex) return this._tagIndex;
    const idx = new Map();
    for (const f of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(f);
      if (!cache) continue;
      for (const raw of new Set(getAllTags(cache) || [])) {
        const parts = raw.replace(/^#/, "").split("/");
        for (let i = 1; i <= parts.length; i++) {
          const t = parts.slice(0, i).join("/");
          if (!idx.has(t)) idx.set(t, new Set());
          idx.get(t).add(f);
        }
      }
    }
    this._tagIndex = idx;
    return idx;
  }
  childTags(parent) {
    const out = [];
    for (const [t, files] of this.tagIndex()) {
      const depth = parent ? parent.split("/").length + 1 : 1;
      if (t.split("/").length !== depth) continue;
      if (parent && !t.startsWith(parent + "/")) continue;
      out.push([t, files.size]);
    }
    return out.sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }

  _filesFor(key) {
    if (key === "file:tags") { const all = new Set(); for (const [t, fs] of this.tagIndex()) if (!t.includes("/")) fs.forEach((f) => all.add(f)); return [...all]; }
    if (key.startsWith("tag:")) return [...(this.tagIndex().get(key.slice(4)) || [])];
    const fc = FILE_COLLECTIONS.find((c) => c.key === key);
    if (fc) {
      const c = (this._coll ||= new Map());
      if (!c.has(key)) c.set(key, this.app.vault.getFiles().filter((f) => fc.ext.includes(f.extension.toLowerCase())));
      return c.get(key);
    }
    const fk = this.parseFolderKey(key);
    if (fk) return [...(this.index.get(fk.type)?.files || []).filter((f) => f.path.startsWith(fk.path + "/")), ...this.nonNoteFiles([fk.path])];
    if (key === "smart:inbox") {
      // every document that isn't in an object type: notes, PDFs, Office files, canvases…
      const root = normalizePath(this.settings.basesFolder || "Typefold") + "/";
      const typeFolders = Object.keys(this.settings.types).filter((k) => !k.includes(":") && this.settings.types[k].registered)
        .flatMap((k) => this.typeFolders(k).map((f) => f + "/"));
      const docExt = new Set(["md", "canvas", ...DOC_EXT]);
      return this.app.vault.getFiles().filter((f) => {
        if (!docExt.has(f.extension.toLowerCase())) return false;
        if (f.path.startsWith(root) || f.path.split("/").some((seg) => seg.startsWith("."))) return false;
        if (f.extension === "md" ? this.fileType.has(f.path) : typeFolders.some((d) => f.path.startsWith(d))) return false;
        if (f.extension === "md" && (this.isFolderNote(f) || this.isTemplate(f))) return false;
        return true;
      });
    }
    if (key === "smart:recent") {
      return (this.settings.recentFiles || []).map((path) => this.app.vault.getAbstractFileByPath(path)).filter((f) => f && f.extension);
    }
    if (key === "smart:tasks") return this.app.vault.getMarkdownFiles().filter((f) =>
      (this.app.metadataCache.getFileCache(f)?.listItems || []).some((li) => li.task === " "));
    if (key === "smart:calendar") return this.app.vault.getMarkdownFiles().filter((f) => this.dailyDate(f));
    const notes = this.index.get(key)?.files || [];
    return this.settings.types[key]?.registered ? [...notes, ...this.nonNoteFiles(this.typeFolders(key))] : notes;
  }

  /** PDFs, canvases, bases and images inside these folders (types only index notes, but the list should show them too) */
  nonNoteFiles(folders) {
    if (!folders.length) return [];
    const show = ["canvas", "base", ...DOC_EXT, ...IMG_EXT];
    const bases = normalizePath(this.settings.basesFolder || "Typefold") + "/";
    return this.app.vault.getFiles().filter((f) => show.includes(f.extension.toLowerCase())
      && !f.path.startsWith(bases) && folders.some((d) => f.path.startsWith(d + "/")));
  }

  /* ── object types: create / assign ── */
  async registerType({ label, icon, color, folder, assign, folderNote, typePage }) {
    const key = label.trim().toLowerCase();
    const c = this.conf(key);
    Object.assign(c, { label: label.trim(), icon, color, registered: true });
    // remember the folder-note choice: new subfolders follow it later ("all" only)
    c.folderNotes = folderNote === true || folderNote === "subs" ? "all" : ["all", "root", "none"].includes(folderNote) ? folderNote : "none";
    if (typePage === false) c.noPage = true; else if (typePage === true) delete c.noPage;
    delete c.hidden;
    if (folder) c.folders = [...new Set([...(c.folders || []), normalizePath(folder)])];
    const order = (this.settings.typeOrder ||= []);
    if (!order.includes(key)) order.push(key);
    await this.saveSettings(false);
    let changed = 0;
    if (folder) {
      // creating the folder fires onFolderCreated: keep that from adding a folder note behind our back
      (this._creatingTypeFolders ||= new Set()).add(normalizePath(folder));
      try { await this.ensureFolder(normalizePath(folder)); }
      finally { window.setTimeout(() => this._creatingTypeFolders?.delete(normalizePath(folder)), 3000); }
      if (assign) changed = await this.assignFolder(folder, label.trim());
      // folderNote: "all" (folder + subfolders), "root" (only this folder), anything else = none
      if (folderNote === "all" || folderNote === true) await this.ensureFolderNotesUnder(folder, label.trim());
      else if (folderNote === "subs") await this.ensureFolderNotesUnder(folder, label.trim(), true);
      else if (folderNote === "root") await this.ensureFolderNote(normalizePath(folder), label.trim());
    }
    this.rebuild();
    return { key, changed };
  }

  /** set `type` on every markdown note under a folder, keeping modification times */
  async assignFolder(folder, label) {
    const prefix = normalizePath(folder) + "/";
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix));
    let n = 0;
    for (const f of files) {
      const cur = typeValues(this.app.metadataCache.getFileCache(f)?.frontmatter?.[this.prop]);
      if (cur.length === 1 && cur[0] === label) continue;
      await this.app.fileManager.processFrontMatter(f, (fm) => { fm[this.prop] = label; }, { mtime: f.stat.mtime });
      n++;
    }
    return n;
  }

  folderBasePath() { return normalizePath(`${normalizePath(this.settings.basesFolder || "Typefold")}/Folder.base`); }
  /** the shared base folder notes embed: lists the notes in the embedding note's folder (and below) */
  async ensureFolderBase() {
    const path = this.folderBasePath();
    if (this.app.vault.getAbstractFileByPath(path)) return;
    await this.ensureFolder(path.split("/").slice(0, -1).join("/"));
    const ext = this.hasExtendedBase();
    const yaml = [
      "filters:",
      "  and:",
      "    - file.inFolder(this.file.folder)",
      "    - file.path != this.file.path",
      "    - file.basename != file.folder.split(\"/\")[-1]", // hide subfolders' folder notes
      "views:",
      `  - type: ${ext ? "bases" : "table"}`,
      "    name: Table",
      "    groupBy:",
      "      property: file.folder",
      "      direction: ASC",
      "    order:",
      "      - file.name",
      "      - file.mtime",
      "    sort:",
      "      - property: file.mtime",
      "        direction: DESC",
      ...(ext ? ["  - type: notion-list", "    name: List", "    order:", "      - file.name", "      - file.mtime"]
              : ["  - type: cards", "    name: Cards", "    order:", "      - file.name", "      - file.mtime"]),
      "",
    ].join("\n");
    try { await this.app.vault.create(path, yaml); } catch (e) { if (!this.app.vault.getAbstractFileByPath(path)) throw e; }
  }
  /** folder notes made by earlier versions point at a Folder.base that was never created: create it once */
  async repairFolderBase() {
    const path = this.folderBasePath();
    if (this.app.vault.getAbstractFileByPath(path)) return;
    const unresolved = this.app.metadataCache.unresolvedLinks || {};
    const want = path.replace(/\.base$/, "").toLowerCase();
    const broken = Object.values(unresolved).some((links) => Object.keys(links).some((l) => {
      const x = l.toLowerCase().replace(/\.base$/, "");
      return x === want;
    }));
    if (broken) await this.ensureFolderBase();
  }

  folderNoteContent(typeLabel, folderPath) {
    const lines = [];
    let best = null, bestLen = -1;
    for (const k of Object.keys(this.settings.types)) {
      if (k.includes(":")) continue;
      for (const f of this.typeFolders(k)) if (folderPath.startsWith(f + "/") && f.length > bestLen) { best = k; bestLen = f.length; }
    }
    if (best) for (const [k, v] of Object.entries(this.folderLevelProps(best, folderPath))) lines.push(`${k}: ${JSON.stringify(v)}`);
    lines.push("cssclasses:", "  - max");
    return "---\n" + lines.join("\n") + `\n---\n\n![[${this.folderBasePath()}]]\n`;
  }

  async ensureFolderNote(folderPath, typeLabel) {
    const st = this.fnSettings();
    if (!st.enabled || !folderPath) return null;
    const existing = this.folderNoteOf(folderPath);
    await this.ensureFolderBase();
    const content = this.folderNoteContent(typeLabel, folderPath);
    if (existing) {
      if (existing.extension === "md" && !(await this.app.vault.read(existing)).trim())
        await this.app.vault.modify(existing, content); // fill an empty auto-created folder note
      return existing;
    }
    const name = st.name.replace("{{folder_name}}", folderPath.split("/").pop());
    const dir = st.location === "parentFolder" ? folderPath.split("/").slice(0, -1).join("/") : folderPath;
    return await this.app.vault.create(normalizePath(`${dir ? dir + "/" : ""}${name}.md`), content);
  }

  async ensureFolderNotesUnder(folder, typeLabel, skipRoot = false) {
    const root = this.app.vault.getAbstractFileByPath(normalizePath(folder));
    if (!(root instanceof TFolder)) return;
    const walk = async (fo) => {
      if (fo.name.startsWith(".") || fo.name.startsWith("_")) return;
      if (!(skipRoot && fo === root)) await this.ensureFolderNote(fo.path, typeLabel);
      for (const c of fo.children) if (c instanceof TFolder) await walk(c);
    };
    await walk(root);
  }

  /** type a brand-new folder belongs to: nearest ancestor folder note's type, else a type rooted above it */
  typeForNewFolder(folder) {
    let cur = folder.parent;
    while (cur && cur.path !== "/") {
      const note = this.folderNoteOf(cur.path);
      const t = note && typeValues(this.app.metadataCache.getFileCache(note)?.frontmatter?.[this.prop])[0];
      if (t) return t;
      cur = cur.parent;
    }
    for (const [key, c] of Object.entries(this.settings.types)) {
      if (c.folder && folder.path.startsWith(normalizePath(c.folder) + "/")) return this.labelFor(key);
    }
    for (const key of this.index.keys()) {
      const r = this.typeRoot(key);
      if (r && folder.path.startsWith(r + "/")) return this.labelFor(key);
    }
    return null;
  }

  async onFolderCreated(folder) {
    if (!this.settings.autoFolderNotes || !(folder instanceof TFolder)) return;
    if (folder.name.startsWith(".") || folder.name.startsWith("_")) return;
    await new Promise((r) => setTimeout(r, 900)); // let Folder Notes create its own first
    if (!this.app.vault.getAbstractFileByPath(folder.path)) return;
    if ([...(this._creatingTypeFolders || [])].some((d) => folder.path === d || d.startsWith(folder.path + "/"))) return;
    // the nearest type this folder sits in decides: only types set to "Folder + subfolders" get notes for new folders
    let owner = null, len = -1;
    for (const [k, c] of Object.entries(this.settings.types)) {
      if (k.includes(":") || !c.registered) continue;
      for (const f of this.typeFolders(k)) if (folder.path.startsWith(f + "/") && f.length > len) { owner = c; len = f.length; }
    }
    if (!owner) return;
    const choice = owner.folderNotes || "all"; // types made before this choice existed keep the old behaviour
    if (choice !== "all") return;
    await this.ensureFolderNote(folder.path, null);
  }

  /** custom icon / colour for a folder path, whichever type's tree it was set in */
  folderStyle(path) {
    for (const [k, c] of Object.entries(this.settings.types)) {
      if (k.startsWith("fold:") && k.endsWith("::" + path) && (c.icon || c.color)) return c;
    }
    return null;
  }

  /* ── type pages: a note per type, styled like folder notes ── */
  typeNotePath(key) {
    const root = normalizePath(this.settings.basesFolder || "Typefold");
    return normalizePath(`${root}/${this.labelFor(key).replace(/[\\/:*?"<>|#^[\]]/g, "-")}.md`);
  }
  async typeNoteFor(key) {
    const path = this.typeNotePath(key);
    const existing = this.app.vault.getAbstractFileByPath(path)
      || this.app.vault.getFiles().find((f) => f.path.toLowerCase() === path.toLowerCase());
    if (existing) return existing;
    const base = await this.baseFileFor(key);
    await this.ensureFolder(path.split("/").slice(0, -1).join("/"));
    return await this.app.vault.create(path, `---\nobject-type: ${key}\ncssclasses:\n  - max\n---\n\n![[${base.path}]]\n`);
  }
  typePageKey(file) {
    const k = this.app.metadataCache.getFileCache(file)?.frontmatter?.["object-type"];
    return k && this.settings.types[String(k)] ? String(k) : null;
  }

  /* ── Folder Notes plugin integration ── */
  clearCaches() { this._fn = new Map(); this._fnSt = null; this._coll = new Map(); this._linkInfo = new Map(); this._tagIndex = null; this.backlinkCache = null; }

  fnSettings() {
    if (this._fnSt) return this._fnSt;
    const st = this.app.plugins?.plugins?.["folder-notes"]?.settings || {};
    return this._fnSt = {
      name: st.folderNoteName || "{{folder_name}}",
      location: st.storageLocation || "insideFolder",
      types: (st.supportedFileTypes || ["md", "canvas", "base"]).map((t) => t.replace(/^\./, "")),
      main: (st.folderNoteType || ".md").replace(/^\./, ""),
      enabled: this.settings.useFolderNotes !== false && !!this.app.plugins?.enabledPlugins?.has?.("folder-notes"),
    };
  }

  /** the folder note file of a folder, or null */
  folderNoteOf(folderPath) {
    const st = this.fnSettings();
    if (!st.enabled || !folderPath) return null;
    const folderName = folderPath.split("/").pop();
    const name = st.name.replace("{{folder_name}}", folderName);
    const dir = st.location === "parentFolder" ? folderPath.split("/").slice(0, -1).join("/") : folderPath;
    const exts = [st.main, ...st.types.filter((t) => t !== st.main)];
    for (const ext of exts) {
      const f = this.app.vault.getAbstractFileByPath(normalizePath(`${dir ? dir + "/" : ""}${name}.${ext}`));
      if (f && f.extension) return f;
    }
    return null;
  }

  /** the folder a file is the folder note of, or null */
  folderOfFolderNote(file) {
    const st = this.fnSettings();
    if (!st.enabled || !file?.parent || !st.types.includes(file.extension)) return null;
    if (st.location === "parentFolder") {
      const dir = file.parent.path === "/" ? "" : file.parent.path;
      const cand = this.app.vault.getAbstractFileByPath(normalizePath(`${dir ? dir + "/" : ""}${file.basename}`));
      return cand && !cand.extension && this.folderNoteOf(cand.path) === file ? cand : null;
    }
    const folder = file.parent;
    if (!folder || folder.path === "/") return null;
    return this.folderNoteOf(folder.path) === file ? folder : null;
  }
  isFolderNote(file) {
    if (!file) return false;
    const m = (this._fn ||= new Map());
    if (!m.has(file.path)) m.set(file.path, !!this.folderOfFolderNote(file));
    return m.get(file.path);
  }

  /* ── folders inside a type ── */
  parseFolderKey(key) {
    if (!key || !key.startsWith("fold:")) return null;
    const i = key.indexOf("::");
    return { type: key.slice(5, i), path: key.slice(i + 2) };
  }
  folderKey(type, path) { return `fold:${type}::${path}`; }

  typeRoot(typeKey) {
    const folders = this.typeFolders(typeKey);
    if (folders.length === 1) return folders[0];
    if (folders.length > 1) return "";
    const files = this.index.get(typeKey)?.files || [];
    if (!files.length) return "";
    let parts = files[0].parent?.path.split("/") || [];
    for (const f of files) {
      const fp = (f.parent?.path || "").split("/");
      let i = 0;
      while (i < parts.length && parts[i] === fp[i]) i++;
      parts = parts.slice(0, i);
    }
    return parts.join("/");
  }

  /** true if another registered type owns this folder (e.g. a sub-type inside a type's folder) */
  claimedByOtherType(path, typeKey) {
    for (const [k, c] of Object.entries(this.settings.types)) {
      if (k !== typeKey && c.registered && c.folder && normalizePath(c.folder) === path) return true;
    }
    return false;
  }

  /** child folder paths directly under `folder` that contain notes of this type */
  subfolders(typeKey, folder) {
    const out = new Map();
    const roots = this.typeFolders(typeKey);
    if (!folder && roots.length > 1) {
      // a type made of several folders: those folders are its first level
      const files = this.index.get(typeKey)?.files || [];
      for (const r of roots) out.set(r, files.filter((f) => f.path.startsWith(r + "/") && !this.isFolderNote(f)).length);
      return [...out.entries()].sort((a, b) => a[0].split("/").pop().localeCompare(b[0].split("/").pop(), undefined, { numeric: true }));
    }
    const prefix = folder ? folder + "/" : "";
    for (const f of this.index.get(typeKey)?.files || []) {
      const fp = f.parent?.path || "";
      if (!fp.startsWith(prefix) || fp === folder) continue;
      if (this.isFolderNote(f) || this.isArchived(f.path)) continue;
      const child = prefix + fp.slice(prefix.length).split("/")[0];
      out.set(child, (out.get(child) || 0) + 1);
    }
    // also show every real subfolder of this folder (even ones without notes of this type yet)
    const tf = folder && this.app.vault.getAbstractFileByPath(folder);
    if (tf instanceof TFolder) {
      for (const c of tf.children) {
        if (c instanceof TFolder && !c.name.startsWith(".") && !out.has(c.path)) out.set(c.path, 0);
      }
    }
    for (const k of [...out.keys()]) if (this.isArchived(k)) out.delete(k);
    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true }));
  }

  typeOfFile(file) { return file ? this.fileType.get(file.path) : null; }
  typesOfFile(file) { return (file && this.fileTypes?.get(file.path)) || []; }

  resolveImage(p, sourcePath) {
    if (!p) return null;
    p = cleanLink(Array.isArray(p) ? p[0] : p);
    if (/^https?:\/\//.test(p)) return p;
    const dest = this.app.metadataCache.getFirstLinkpathDest(p, sourcePath);
    return dest && IMG_EXT.includes(dest.extension.toLowerCase()) ? this.app.vault.getResourcePath(dest) : null;
  }
  thumbnailFor(file, frontmatterOnly = false) {
    if (IMG_EXT.includes(file.extension.toLowerCase())) return this.app.vault.getResourcePath(file);
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (fm) for (const k of THUMB_KEYS) { const r = this.resolveImage(fm[k], file.path); if (r) return r; }
    if (frontmatterOnly) return null;
    for (const e of cache?.embeds || []) { const r = this.resolveImage(e.link, file.path); if (r) return r; }
    return null;
  }

  backlinksOf(file) {
    // scan sources for this one target (cheap) instead of building a map of every link in the vault
    const cache = (this.backlinkCache ||= new Map());
    if (cache.has(file.path)) return cache.get(file.path);
    const rl = this.app.metadataCache.resolvedLinks;
    const out = [];
    for (const src in rl) {
      if (src === file.path || !rl[src][file.path]) continue;
      const f = this.app.vault.getAbstractFileByPath(src);
      if (f && f.extension === "md") out.push(f);
    }
    cache.set(file.path, out);
    return out;
  }


  /* ── archive: hidden from the panel, nothing is moved ── */
  isArchived(path) {
    return (this.settings.archived || []).some((a) => path === a || path.startsWith(a + "/"));
  }
  async setArchived(path, on) {
    const list = new Set(this.settings.archived || []);
    on ? list.add(path) : list.delete(path);
    this.settings.archived = [...list].sort();
    await this.saveSettings();
  }
  archivedFiles() {
    return this.app.vault.getMarkdownFiles().filter((f) => this.isArchived(f.path) && !this.isFolderNote(f));
  }

  /* ── delete a type: unregister it, so its chip disappears from every note ── */
  async deleteType(key, { removeProperty, removePage }) {
    const label = this.labelFor(key);
    let changed = 0;
    if (removeProperty) {
      for (const f of this.app.vault.getMarkdownFiles()) {
        const vals = typeValues(this.app.metadataCache.getFileCache(f)?.frontmatter?.[this.prop]);
        if (!vals.some((v) => v.toLowerCase() === key)) continue;
        await this.app.fileManager.processFrontMatter(f, (fm) => {
          const v = fm[this.prop];
          if (Array.isArray(v)) { const rest = v.filter((x) => String(x).toLowerCase() !== key); if (rest.length) fm[this.prop] = rest; else delete fm[this.prop]; }
          else delete fm[this.prop];
        }, { mtime: f.stat.mtime });
        changed++;
      }
    }
    if (removePage) {
      // the type's page is two files: the note you open and the .base it embeds
      for (const path of [this.typeNotePath(key), this.basePath(key, null)]) {
        const f = this.app.vault.getAbstractFileByPath(path);
        if (f) await this.app.vault.trash(f, false);
      }
    }
    delete this.settings.types[key];
    for (const k of Object.keys(this.settings.types)) if (k.startsWith(`fold:${key}::`)) delete this.settings.types[k];
    for (const k of Object.keys(this.settings.expanded || {})) if (k === key || k.startsWith(`fold:${key}::`)) delete this.settings.expanded[k];
    this.settings.typeOrder = (this.settings.typeOrder || []).filter((k) => k !== key);
    this.settings.pinned = this.settings.pinned.filter((x) => !(x.kind === "type" && x.id === key));
    if ((this.settings.lastSelected || "").startsWith(key) || (this.settings.lastSelected || "").startsWith(`fold:${key}::`)) this.settings.lastSelected = null;
    await this.saveSettings();
    return { label, changed };
  }

  calendarMerged() { return !this.settings.splitCalendarTasks; }
  hasDailyNotes() { return this.app.vault.getMarkdownFiles().some((f) => this.dailyDate(f)); }

  /** Recents: remember opened files, newest first */
  noteRecent(file) {
    if (!file || !file.extension) return;
    const list = (this.settings.recentFiles ||= []);
    if (list[0] === file.path) return;
    const i = list.indexOf(file.path);
    if (i >= 0) list.splice(i, 1);
    list.unshift(file.path);
    list.length = Math.min(list.length, 60);
    (this._saveRecents ||= debounce(() => {
      this.saveData(this.settings);
      if (this.settings.showRecents) for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) leaf.view?.render?.();
    }, 1500, true))();
  }

  /** once per version: the guide on a fresh install, what's new after an update */
  async maybeShowWhatsNew() {
    const s = this.settings, v = this.manifest.version;
    if (s.lastSeenVersion === v) return;
    const fresh = !s.lastSeenVersion && !Object.values(s.types || {}).some((c) => c.registered);
    s.lastSeenVersion = v;
    await this.saveData(s);
    if (!s.showWhatsNew) return;
    window.setTimeout(() => new WhatsNewModal(this, fresh ? "start" : "new").open(), 800);
  }

  /* ── tasks: TaskNotes tasks when that plugin is on, otherwise `- [ ]` checkboxes in notes ── */
  taskNotes() {
    const t = this.app.plugins?.plugins?.tasknotes;
    return t?.cacheManager?.getAllTasks && t?.taskService ? t : null;
  }
  taskPrefs(scope = "all") {
    this.settings.taskViews ||= {};
    return (this.settings.taskViews[scope] ||= { mode: "list", bg: null });
  }
  async collectTasks() {
    const out = [];
    const day = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null);
    const hm = (v) => String(v || "").match(/T(\d{2}:\d{2})/)?.[1] || null;
    const tn = this.settings.taskSource === "tasknotes" ? this.taskNotes() : null;
    if (tn) {
      const taskTag = String(tn.settings.taskTag || "task").toLowerCase();
      const statuses = tn.settings.customStatuses || [];
      const prios = tn.settings.customPriorities || [];
      const baseWeight = prios.find((x) => x.value === tn.settings.defaultTaskPriority)?.weight ?? 0;
      let all = [];
      try { all = await tn.cacheManager.getAllTasks(); } catch (e) { console.warn("Typefold: TaskNotes tasks", e); }
      for (const t of all) {
        if (t.archived) continue;
        const file = this.app.vault.getAbstractFileByPath(t.path);
        if (!file) continue;
        const notes = (t.projects || []).map((pr) => this.app.metadataCache.getFirstLinkpathDest(cleanLink(pr), t.path)).filter(Boolean);
        const prio = prios.find((x) => x.value === t.priority);
        out.push({
          kind: "tn", raw: t, file, notes, title: t.title || file.basename,
          done: tn.statusManager?.isCompletedStatus?.(t.status) ?? !!statuses.find((s) => s.value === t.status)?.isCompleted,
          due: day(t.due), scheduled: day(t.scheduled), time: hm(t.scheduled) || hm(t.due),
          tags: (t.tags || []).filter((x) => String(x).toLowerCase() !== taskTag),
          prioColor: prio && prio.weight > baseWeight ? prio.color : null,
          prioLabel: prio && prio.weight > baseWeight ? prio.label || prio.value : null,
          statusColor: statuses.find((s) => s.value === t.status)?.color || null,
        });
      }
    }
    if (this.settings.taskSource === "tasks" && this.tasksPlugin()?.cache) out.push(...this.tasksPluginTasks());
    else if (this.settings.taskSource !== "tasknotes") out.push(...await this.checkboxTasks(this.taskNotes()));
    return out;
  }
  tasksPlugin() { return this.app.plugins?.plugins?.["obsidian-tasks-plugin"] || null; }
  /** tasks from the Tasks plugin's own cache (respects its global filter); falls back to the checkbox parser */
  tasksPluginTasks() {
    const tp = this.tasksPlugin();
    let list = [];
    try { list = tp.cache.getTasks?.() || []; } catch (e) { console.warn("Typefold: Tasks plugin cache", e); }
    const day = (m) => (m && typeof m.format === "function" && m.isValid?.() !== false ? m.format("YYYY-MM-DD") : null);
    const prio = { "0": ["#FF3B30", "Highest"], "1": ["#FF9500", "High"], "2": ["#FFCC00", "Medium"] };
    const gf = String(this.tasksGlobalFilter() || "").trim();
    const out = [];
    for (const t of list) {
      const path = t.taskLocation?.path ?? t.path;
      const line = t.taskLocation?.lineNumber ?? t.lineNumber;
      const file = path && this.app.vault.getAbstractFileByPath(path);
      if (!file || line == null) continue;
      const tags = (t.tags || []).map((x) => String(x).replace(/^#/, "")).filter((x) => !gf || "#" + x !== gf);
      let title = String(t.description || "");
      if (gf) title = title.split(gf).join(" ");
      title = title.replace(/(?:^|\s)#[^\s#]+/g, " ").replace(/\s+/g, " ").trim();
      if (!title) continue;
      const done = typeof t.status?.isCompleted === "function" ? t.status.isCompleted() : (t.isDone ?? ["x", "X"].includes(t.status?.symbol));
      const pr = prio[String(t.priority)] || null;
      out.push({ kind: "tp", raw: t, file, line, notes: [file], title, done: !!done, due: day(t.dueDate), scheduled: day(t.scheduledDate),
        time: null, tags, prioColor: pr?.[0] || null, prioLabel: pr?.[1] || null });
    }
    return out;
  }
  tasksGlobalFilter() {
    const tp = this.tasksPlugin();
    try { return tp?.settings?.globalFilter ?? tp?.getSettings?.()?.globalFilter ?? ""; } catch (e) { return ""; }
  }
  async checkboxTasks(tn) {
    const out = [];
    this._taskLines ||= new Map(); // path -> { mtime, lines }
    const day = /(\d{4}-\d{2}-\d{2})/.source;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const items = (this.app.metadataCache.getFileCache(file)?.listItems || []).filter((li) => li.task !== undefined);
      if (!items.length) continue;
      if (tn && tn.cacheManager.isTaskFile?.(this.app.metadataCache.getFileCache(file)?.frontmatter)) continue;
      let c = this._taskLines.get(file.path);
      if (!c || c.mtime !== file.stat.mtime) {
        c = { mtime: file.stat.mtime, lines: (await this.app.vault.cachedRead(file)).split("\n") };
        this._taskLines.set(file.path, c);
      }
      for (const li of items) {
        const lineNo = li.position.start.line;
        const raw = (c.lines[lineNo] || "").replace(/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[.\]\s?/, "");
        const due = raw.match(new RegExp(`📅\\s*${day}`))?.[1] || raw.match(new RegExp(`\\[?due::\\s*${day}`))?.[1] || null;
        const scheduled = raw.match(new RegExp(`⏳\\s*${day}`))?.[1] || raw.match(new RegExp(`\\[?scheduled::\\s*${day}`))?.[1] || null;
        const tags = [...raw.matchAll(/(?:^|\s)#([^\s#]+)/g)].map((m) => m[1]);
        const title = raw
          .replace(/\[?\w+::[^\]]*\]?/g, "")
          .replace(/[📅⏳🛫✅➕❌]️?\s*\d{4}-\d{2}-\d{2}/gu, "")
          .replace(/🔁️?[^📅⏳🛫✅➕❌🔺⏫🔼🔽⏬]*/gu, "")
          .replace(/[🔺⏫🔼🔽⏬]️?/gu, "")
          .replace(/(?:^|\s)#[^\s#]+/g, " ")
          .replace(/\s+/g, " ").trim();
        if (!title) continue;
        const pe = raw.match(/[🔺⏫🔼]/u)?.[0];
        const prioColor = pe ? { "🔺": "#FF3B30", "⏫": "#FF9500", "🔼": "#FFCC00" }[pe] : null;
        out.push({ kind: "cb", file, line: lineNo, notes: [file], title, done: li.task !== " ", due, scheduled, time: null, tags, prioColor,
          prioLabel: pe ? { "🔺": "Highest", "⏫": "High", "🔼": "Medium" }[pe] : null });
      }
    }
    return out;
  }
  /** does a task belong to this object type? (its file, a linked project note, or a tag with the type's name) */
  taskInType(task, key) {
    if (!key || key === "all") return true;
    const label = this.labelFor(key).toLowerCase();
    return [task.file, ...task.notes].some((f) => this.typesOfFile(f).includes(key) || this.typeOfFile(f) === key)
      || task.tags.some((t) => String(t).toLowerCase() === label || String(t).toLowerCase().endsWith("/" + label));
  }
  async toggleTask(task) {
    if (task.kind === "tp") {
      // let the Tasks plugin do it (done date, recurrence); otherwise flip the box ourselves
      const api = this.tasksPlugin()?.apiV1;
      if (api?.executeToggleTaskDoneCommand) {
        let ok = false;
        await this.app.vault.process(task.file, (data) => {
          const lines = data.split("\n");
          const l = lines[task.line];
          if (l == null) return data;
          const next = api.executeToggleTaskDoneCommand(l, task.file.path);
          if (typeof next !== "string") return data;
          lines.splice(task.line, 1, ...next.split("\n"));
          ok = true;
          return lines.join("\n");
        });
        if (ok) return;
      }
    }
    if (task.kind === "tn") {
      const tn = this.taskNotes();
      if (tn) return tn.taskService.toggleStatus(task.raw);
    }
    await this.app.vault.process(task.file, (data) => {
      const lines = data.split("\n");
      const l = lines[task.line];
      if (l == null) return data;
      lines[task.line] = l.replace(/^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+)\[(.)\]/, (m, pre, ch) => `${pre}[${ch === " " ? "x" : " "}]`);
      return lines.join("\n");
    });
  }
  async deleteTask(task) {
    if (task.kind === "tn") {
      const tn = this.taskNotes();
      if (!tn) throw new Error("TaskNotes isn't enabled");
      return tn.api.deleteTask(task.file.path);
    }
    await this.app.vault.process(task.file, (data) => {
      const lines = data.split("\n");
      const l = lines[task.line];
      // only remove the line if it is still that task (the note may have changed meanwhile)
      if (l == null || !/^\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[.\]/.test(l) || !l.includes(task.title.slice(0, 20))) throw new Error("The task line moved; open the note and delete it there.");
      lines.splice(task.line, 1);
      return lines.join("\n");
    });
  }
  /** add a task: a TaskNotes task (natural language: "Call mom tomorrow 3pm #family"), or a checkbox in today's daily note */
  async addTask(text, { date = null, tag = null, field = "any" } = {}) {
    text = text.trim();
    if (!text) return;
    const tn = this.settings.taskSource === "tasknotes" ? this.taskNotes() : null;
    if (tn) {
      let parsed = {};
      try { parsed = tn.api.parseNaturalLanguage(text) || {}; } catch (e) {}
      const at = (d, t) => (d ? (t ? `${d}T${t}` : d) : undefined);
      const data = { title: parsed.title || text, tags: [...(parsed.tags || [])], contexts: parsed.contexts || [], projects: parsed.projects || [] };
      if (parsed.priority) data.priority = parsed.priority;
      if (parsed.status) data.status = parsed.status;
      if (parsed.dueDate) data.due = at(parsed.dueDate, parsed.dueTime);
      if (parsed.scheduledDate) data.scheduled = at(parsed.scheduledDate, parsed.scheduledTime);
      if (!data.due && !data.scheduled && date) data[field === "due" || field === "scheduled" ? field : tn.settings.nlpDefaultToScheduled === false ? "due" : "scheduled"] = date;
      if (tag && !data.tags.some((t) => t.toLowerCase() === tag.toLowerCase())) data.tags.push(tag);
      return tn.api.createTask(data);
    }
    const gf = this.settings.taskSource === "tasks" ? String(this.tasksGlobalFilter() || "").trim() : "";
    let line = `- [ ] ${gf && !text.includes(gf) ? gf + " " : ""}${text}`;
    if (tag && !new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`, "i").test(text)) line += ` #${tag}`;
    if (date && !/📅|⏳|due::|scheduled::/.test(text)) line += field === "scheduled" ? ` ⏳ ${date}` : ` 📅 ${date}`;
    const file = await this.ensureDaily(moment());
    await this.app.vault.process(file, (data) => (data && !data.endsWith("\n") ? data + "\n" : data) + line + "\n");
  }
  async openTask(task, newLeaf = false) {
    const leaf = this.app.workspace.getLeaf(newLeaf);
    if (task.kind === "cb") await leaf.openFile(task.file, { eState: { line: task.line } });
    else await leaf.openFile(task.file);
  }
  async openTasks(scope = "all") {
    const existing = this.app.workspace.getLeavesOfType(TASKS_VIEW)[0];
    const leaf = existing || this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: TASKS_VIEW, active: true, state: { scope } });
    this.app.workspace.revealLeaf(leaf);
  }
  refreshTasks() {
    for (const leaf of this.app.workspace.getLeavesOfType(TASKS_VIEW)) leaf.view?.render?.();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      const sel = leaf.view?.selected;
      if (sel === "smart:tasks" || (sel === "smart:calendar" && this.calendarMerged() && this.settings.taskPanelView !== "daily")) leaf.view.render();
    }
  }

  /* ── pins ── */
  isPinned(kind, id) { return this.settings.pinned.some((p) => p.kind === kind && p.id === id); }
  async togglePin(kind, id) {
    if (this.isPinned(kind, id)) this.settings.pinned = this.settings.pinned.filter((p) => !(p.kind === kind && p.id === id));
    else this.settings.pinned.push({ kind, id });
    await this.saveSettings(false);
    this.refreshViews();
  }
  renamePinned(oldPath, newPath) {
    for (const p of this.settings.pinned) if (p.kind === "note" && p.id === oldPath) p.id = newPath;
    const ri = (this.settings.recentFiles || []).indexOf(oldPath);
    if (ri >= 0) this.settings.recentFiles[ri] = newPath;
    for (const k of ["defaultBanners", "noteIcons", "bannerStyles"]) {
      const m = this.settings[k];
      if (m && oldPath in m) { m[newPath] = m[oldPath]; delete m[oldPath]; }
    }
    this.saveData(this.settings);
  }

  /* ── per-type / per-folder .base pages (Extended Base notion views) ── */
  typeValuesFor(key) {
    const label = this.labelFor(key);
    const vals = [...new Set((this.index.get(key)?.files || []).map((f) =>
      typeValues(this.app.metadataCache.getFileCache(f)?.frontmatter?.[this.prop]).find((v) => v.toLowerCase() === key)).filter(Boolean))];
    return vals.length ? vals : [label];
  }

  typeFilterConds(typeKey) {
    const q = (v) => JSON.stringify(v);
    const conds = this.typeFolders(typeKey).map((f) => `file.inFolder(${q(f)})`);
    if (this.settings.types[typeKey]?.matchProperty || !conds.length)
      conds.push(...this.typeValuesFor(typeKey).map((v) => `note[${q(this.prop)}] == ${q(v)}`));
    return conds;
  }

  filtersBlock(typeKey, folder) {
    const q = (v) => JSON.stringify(v);
    const conds = this.typeFilterConds(typeKey);
    const lines = ["filters:", "  and:"];
    if (conds.length === 1) lines.push(`    - '${conds[0]}'`);
    else { lines.push("    - or:"); conds.forEach((c) => lines.push(`        - '${c}'`)); }
    if (folder) lines.push(`    - 'file.inFolder(${q(folder)})'`);
    lines.push(`    - 'file.basename != file.folder.split("/")[-1]'`);
    return lines.join("\n");
  }

  /** Extended Base (Notion-style views) installed and enabled? Otherwise use core Bases views. */
  hasExtendedBase() { return !!this.app.plugins?.enabledPlugins?.has("extended-base"); }

  baseYaml(typeKey, folder) {
    const c = this.settings.types[typeKey] || {};
    const lines = this.filtersBlock(typeKey, folder).split("\n");
    const levels = (c.folderProps || []).map((x) => (typeof x === "string" ? x : x.name)).filter(Boolean);
    const extra = Object.keys(c.defaultProps || {});
    const cols = [...new Set(["file.name", ...levels, ...extra, ...(c.columns || []), "file.mtime"])];
    // group the table by the next folder level below what's shown
    const depth = folder ? folder.split("/").length - (this.typeRoot(typeKey) || "").split("/").filter(Boolean).length : 0;
    const group = levels[depth] || "file.folder";
    const board = (extra.includes("status") && "status") || levels[depth] || "file.folder";
    const order = (indent) => cols.map((x) => `${indent}- ${x}`);
    const ext = this.hasExtendedBase();
    lines.push(
      "views:",
      `  - type: ${ext ? "bases" : "table"}`,
      "    name: Table",
      "    groupBy:",
      `      property: ${group}`,
      "      direction: ASC",
      "    order:", ...order("      "),
      "    sort:",
      "      - property: file.mtime",
      "        direction: DESC");
    if (ext) lines.push(
      "  - type: notion-board",
      "    name: Board",
      "    groupBy:",
      `      property: ${board}`,
      "      direction: ASC",
      "    order:", ...order("      "),
      "  - type: notion-list",
      "    name: List",
      "    order:", ...order("      "),
      "  - type: notion-feed",
      "    name: Feed",
      "    order:",
      "      - file.name");
    else lines.push(
      "  - type: cards",
      "    name: Cards",
      "    order:",
      "      - file.name",
      "      - file.mtime");
    lines.push("");
    return lines.join("\n");
  }

  basePath(typeKey, folder) {
    const clean = (s) => s.replace(/[\\:*?"<>|#^[\]]/g, "-");
    const root = normalizePath(this.settings.basesFolder || "Typefold");
    const label = clean(this.labelFor(typeKey));
    if (!folder) return normalizePath(`${root}/${label}.base`);
    const tr = this.typeRoot(typeKey);
    const rel = folder.startsWith(tr + "/") ? folder.slice(tr.length + 1) : folder;
    return normalizePath(`${root}/${label}/${rel.split("/").map(clean).join("/")}.base`);
  }

  async ensureFolder(path) {
    const parts = path.split("/"); let cur = "";
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) await this.app.vault.createFolder(cur);
    }
  }

  async baseFileFor(key) {
    const fk = this.parseFolderKey(key);
    const typeKey = fk ? fk.type : key;
    const path = this.basePath(typeKey, fk?.path);
    const existing = this.app.vault.getAbstractFileByPath(path)
      || this.app.vault.getFiles().find((f) => f.path.toLowerCase() === path.toLowerCase()); // e.g. templates.base vs Templates.base
    if (existing) {
      // upgrade pages generated by the first version (plain table/cards) to notion views
      let txt = await this.app.vault.cachedRead(existing);
      // keep the page's views, but switch its filter to the type's folders
      const vi = txt.indexOf("\nviews:");
      if (!fk && vi > 0 && txt.startsWith("filters:")) {
        const nf = this.filtersBlock(typeKey, null);
        if (txt.slice(0, vi) !== nf) { txt = nf + txt.slice(vi); await this.app.vault.modify(existing, txt); }
      }
      if (/name: By folder\n/.test(txt) && /type: cards/.test(txt) && !/notion-/.test(txt))
        await this.app.vault.modify(existing, this.baseYaml(typeKey, fk?.path));
      return existing;
    }
    await this.ensureFolder(path.split("/").slice(0, -1).join("/"));
    return await this.app.vault.create(path, this.baseYaml(typeKey, fk?.path));
  }

  /* ── daily notes (core Daily notes settings) ── */
  dailySettings() {
    const o = this.app.internalPlugins?.getPluginById?.("daily-notes")?.instance?.options || {};
    return { folder: (o.folder || "").trim().replace(/^\/+|\/+$/g, ""), format: (o.format || "").trim() || "YYYY-MM-DD", template: (o.template || "").trim() };
  }
  /** the date a daily note stands for, or null */
  dailyDate(f) {
    if (!f || f.extension !== "md") return null;
    const { folder, format } = this.dailySettings();
    if (folder && !f.path.startsWith(folder + "/")) return null;
    const rel = (folder ? f.path.slice(folder.length + 1) : f.path).replace(/\.md$/, "");
    let m = moment(rel, format, true);
    if (!m.isValid() && !format.includes("/")) m = moment(f.basename, format, true);
    return m.isValid() ? m : null;
  }
  dailyPath(m) {
    const { folder, format } = this.dailySettings();
    return normalizePath((folder ? folder + "/" : "") + m.format(format) + ".md");
  }
  async openDaily(m, evt) {
    return this.openFromPanel(await this.ensureDaily(m), evt);
  }
  /** the daily note for this date, created (from the daily template) if missing */
  async ensureDaily(m) {
    const path = this.dailyPath(m);
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      const dir = path.split("/").slice(0, -1).join("/");
      if (dir && !this.app.vault.getAbstractFileByPath(dir)) await this.app.vault.createFolder(dir).catch(() => {});
      let body = "";
      const tpl = this.dailySettings().template;
      const tf = tpl && this.app.metadataCache.getFirstLinkpathDest(tpl, "");
      if (tf) {
        const now = moment();
        body = (await this.app.vault.cachedRead(tf))
          .replace(/{{\s*date\s*:\s*([^}]+?)\s*}}/gi, (_, f) => m.format(f))
          .replace(/{{\s*time\s*:\s*([^}]+?)\s*}}/gi, (_, f) => now.format(f))
          .replace(/{{\s*date\s*}}/gi, m.format(this.dailySettings().format))
          .replace(/{{\s*time\s*}}/gi, now.format("HH:mm"))
          .replace(/{{\s*title\s*}}/gi, m.format(this.dailySettings().format));
      }
      file = await this.app.vault.create(path, body);
    }
    return file;
  }

  /** type pages (a note + .base listing the type's notes) are made only when allowed: globally and for this type */
  typePagesAllowed(key) { return this.settings.openBaseOnClick !== false && !this.settings.types[key]?.noPage; }
  async openTypeBase(key, newTab = false) {
    if (!this.typePagesAllowed(key)) return false;
    try {
      const note = this.app.vault.getAbstractFileByPath(this.typeNotePath(key));
      if (note && this.app.vault.getAbstractFileByPath(this.basePath(key, null))) {
        // open right away; bring the page's filter in line with the type's folders afterwards
        await this.app.workspace.getLeaf(newTab).openFile(note);
        this.baseFileFor(key).catch((e) => console.warn("[typefold] base sync", e));
        return;
      }
      await this.baseFileFor(key);
      const file = await this.typeNoteFor(key);
      await this.app.workspace.getLeaf(newTab).openFile(file);
    } catch (e) { console.error("[typefold] could not open base", e); }
  }

  /* ── template: properties for new notes ── */
  /** properties a type fills in: one per folder level below the type's folder, plus fixed defaults */
  folderLevelProps(typeKey, folder) {
    const c = this.settings.types[typeKey] || {};
    const tr = this.typeRoot(typeKey);
    const rel = folder && tr && folder.startsWith(tr + "/") ? folder.slice(tr.length + 1).split("/") : [];
    const out = {};
    (c.folderProps || []).forEach((lv, i) => {
      const name = typeof lv === "string" ? lv : lv?.name;
      const match = typeof lv === "object" && lv?.match ? new RegExp(lv.match) : null;
      if (name && rel[i] && (!match || match.test(rel[i]))) out[name] = rel[i];
    });
    return out;
  }

  templateProps(typeKey, folder) {
    const c = this.settings.types[typeKey] || {};
    const today = moment().format("YYYY-MM-DD");
    const out = this.folderLevelProps(typeKey, folder);
    for (const [k, v] of Object.entries(c.defaultProps || {})) {
      out[k] = typeof v === "string" ? v.replace(/\{\{date\}\}/g, today) : v;
    }
    return out;
  }

  /* ── creation ── */
  newObjectFlow() { new TypePickerModal(this, (key) => this.createObject(key)).open(); }

  async createObject(key, extra = {}) {
    let fk = this.parseFolderKey(key);
    if (fk) key = fk.type;
    const conf = this.settings.types[key] || {};
    if (conf.newIn === "root") fk = null; // “Always the type's folder”
    const label = this.labelFor(key);
    const folder = normalizePath(fk?.path || this.typeFolders(key)[0] || this.settings.defaultFolder || "/");
    if (folder !== "/" && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const base = `Untitled ${label}`.replace(/[\\/:*?"<>|#^[\]]/g, "-");
    let path, i = 0;
    do {
      path = normalizePath(`${folder === "/" ? "" : folder + "/"}${base}${i ? " " + i : ""}.md`);
      i++;
    } while (this.app.vault.getAbstractFileByPath(path));
    const props = Object.assign(this.templateProps(key, folder === "/" ? "" : folder), extra);
    // template note: its text, and its properties under ours
    const tpl = conf.template && this.app.vault.getAbstractFileByPath(normalizePath(conf.template));
    let body = "";
    if (tpl && tpl.extension === "md") {
      const raw = await this.app.vault.cachedRead(tpl);
      const fmEnd = raw.startsWith("---") ? raw.indexOf("\n---", 3) : -1;
      const after = fmEnd > 0 ? raw.indexOf("\n", fmEnd + 4) : -1;
      body = (fmEnd > 0 ? (after < 0 ? "" : raw.slice(after + 1)) : raw)
        .replace(/\{\{\s*date\s*\}\}/gi, moment().format("YYYY-MM-DD"))
        .replace(/\{\{\s*time\s*\}\}/gi, moment().format("HH:mm"))
        .replace(/\{\{\s*title\s*\}\}/gi, base);
    }
    const lines = conf.matchProperty || !this.typeFolders(key).length ? [`${this.prop}: ${JSON.stringify(label)}`] : [];
    for (const [k, v] of Object.entries(props)) lines.push(`${k}: ${JSON.stringify(v)}`);
    const file = await this.app.vault.create(path, (lines.length ? `---\n${lines.join("\n")}\n---\n\n` : "") + body.replace(/^\n+/, ""));
    if (tpl) {
      const tfm = this.app.metadataCache.getFileCache(tpl)?.frontmatter || {};
      const extraFm = Object.entries(tfm).filter(([k]) => k !== "position" && !(k in props) && k !== this.prop);
      if (extraFm.length) await this.app.fileManager.processFrontMatter(file, (fm) => {
        for (const [k, v] of extraFm) if (!(k in fm)) fm[k] = typeof v === "string" ? v.replace(/\{\{\s*date\s*\}\}/gi, moment().format("YYYY-MM-DD")) : v;
      });
    }
    await this.app.workspace.getLeaf(false).openFile(file, { eState: { rename: "all" } });
    return file;
  }

  /* ── views ── */
  /* ── property types (Obsidian keeps one type per property name, vault-wide) ── */
  propType(name) {
    const m = this.app.metadataTypeManager;
    try { return m?.getAssignedType?.(name) || m?.getPropertyInfo?.(name)?.type || m?.properties?.[String(name).toLowerCase()]?.type || "text"; }
    catch (e) { return "text"; }
  }
  setPropType(name, type) {
    const m = this.app.metadataTypeManager;
    if (!name || !type || this.propType(name) === type) return;
    try { m?.setType?.(name, type); } catch (e) { console.warn("Typefold: property type", name, e); }
  }
  /** the type most notes already use for this property (from their values); "text" when no note has it */
  inferPropType(name) {
    if (!name) return "text";
    const now = Date.now();
    if (!this._propTypeIdx || now - this._propTypeIdx.at > 5000) {
      const idx = new Map(); // name(lowercase) → Map(type → count)
      const kind = (v) => {
        if (Array.isArray(v)) return "multitext";
        if (typeof v === "boolean") return "checkbox";
        if (typeof v === "number") return "number";
        if (typeof v === "string") {
          if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return "datetime";
          if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return "date";
          return "text";
        }
        return null; // null / empty values say nothing about the type
      };
      for (const f of this.app.vault.getMarkdownFiles()) {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
        if (!fm) continue;
        for (const [k, v] of Object.entries(fm)) {
          if (k === "position") continue;
          const t = kind(v);
          if (!t) continue;
          const m = idx.get(k.toLowerCase()) || new Map();
          m.set(t, (m.get(t) || 0) + 1);
          idx.set(k.toLowerCase(), m);
        }
      }
      this._propTypeIdx = { at: now, idx };
    }
    const m = this._propTypeIdx.idx.get(String(name).toLowerCase());
    if (!m || !m.size) return "text";
    return [...m.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }

  /** a value as typed in the dialog → what goes into frontmatter for that property type */
  coerceProp(type, raw) {
    const v = raw == null ? "" : String(raw).trim();
    if (type === "checkbox") return v === "true" || v === "1" || v === "yes";
    if (type === "number") return v === "" ? "" : Number.isFinite(Number(v)) ? Number(v) : v;
    if (type === "multitext" || type === "tags" || type === "aliases") return v ? v.split(",").map((x) => x.trim()).filter(Boolean) : [];
    return v;
  }

  /** the note chosen as Home in settings, if Home is set to a note */
  homeFile() {
    if (this.settings.homeMode !== "note" || !this.settings.homeNote) return null;
    const f = this.app.vault.getAbstractFileByPath(normalizePath(this.settings.homeNote))
      || this.app.metadataCache.getFirstLinkpathDest(this.settings.homeNote.replace(/\.md$/, ""), "");
    return f && f.extension ? f : null;
  }
  homeLeaf() {
    const f = this.homeFile();
    if (!f) return this.app.workspace.getLeavesOfType(HOME_VIEW)[0] || null;
    let found = null;
    this.app.workspace.iterateRootLeaves((l) => { if (!found && l.view?.file?.path === f.path) found = l; });
    return found;
  }
  async openHome(newTab = false) {
    const f = this.homeFile();
    if (f) {
      const there = this.homeLeaf();
      if (there && !newTab) { this.app.workspace.setActiveLeaf(there, { focus: true }); this.app.workspace.revealLeaf(there); return; }
      await this.app.workspace.getLeaf(newTab ? "tab" : false).openFile(f);
      return;
    }
    if (this.settings.homeMode === "note" && this.settings.homeNote) new Notice(`Home note “${this.settings.homeNote}” wasn't found, so the Typefold Home opened instead.`);
    const existing = this.app.workspace.getLeavesOfType(HOME_VIEW)[0];
    if (existing && !newTab) { this.app.workspace.revealLeaf(existing); return; }
    const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
    await leaf.setViewState({ type: HOME_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshViews(activeOnly = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW)) leaf.view?.render?.();
    for (const h of this.homeEmbeds || []) h.render();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (!(leaf.view instanceof TypefoldView)) continue;
      activeOnly ? leaf.view.markActive() : leaf.view.render();
    }
  }

  async activateView(reveal = true) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) workspace.iterateAllLeaves((l) => { if (!leaf && l.getViewState?.().type === VIEW_TYPE) leaf = l; });
    if (!leaf) {
      leaf = workspace.getLeftLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      // size the sidebar to what's shown: just the tree, or tree + a compact note list
      try {
        const st = this.settings;
        workspace.leftSplit?.setSize?.(st.listClosed ? st.navWidth + 16 : st.navWidth + 300);
      } catch (e) {}
    }
    if (reveal) workspace.revealLeaf(leaf);
  }

  /* ───────── note decoration (banner, chips, related cards) ───────── */
  decorateAll() {
    this.app.workspace.getLeavesOfType("markdown").forEach((leaf) => {
      if (leaf.view instanceof MarkdownView && leaf.view.containerEl.isShown?.() !== false) this.decorate(leaf.view);
    });
    this.updateStatus();
  }

  bumpDeco() { this._decoVer = (this._decoVer || 0) + 1; }
  decorate(view) {
    const file = view.file;
    const root = view.contentEl;
    // skip views whose note, settings and data haven't changed since they were last drawn
    const sig = file ? `${file.path}|${file.stat.mtime}|${this._decoVer || 0}` : "";
    if (file && view._otSig === sig) {
      if (!view._otObj) return;
      const titles = root.querySelectorAll(".inline-title").length;
      if (root.querySelectorAll(".ot-note-chipsrow").length >= titles) return;
    }
    root.querySelectorAll(".ot-note-header, .ot-related").forEach((el) => el.remove());
    view._otSig = sig;
    if (!file) return;
    const typeKey = this.typeOfFile(file);
    const fnFolder = this.folderOfFolderNote(file);
    const typePage = this.typePageKey(file);
    view.containerEl.toggleClass("ot-object-note", !!typeKey || !!fnFolder || !!typePage);
    view.containerEl.toggleClass("ot-folder-note", !!fnFolder || !!typePage);
    view.containerEl.toggleClass("ot-type-page", !!typePage);
    view._otObj = !!(typeKey || fnFolder || typePage);
    // the editor may not have drawn the title yet: try again on the next frames (a few times at most)
    if (view._otObj && !root.querySelector(".inline-title")) {
      view._otSig = null;
      const n = (view._otTries || 0) + 1;
      view._otTries = n;
      if (n <= 12) requestAnimationFrame(() => { if (view.file === file) this.decorate(view); });
      return;
    }
    view._otTries = 0;

    if (typeKey || fnFolder || typePage) {
      root.querySelectorAll(".inline-title").forEach((title) => {
        // layout: [banner] → [Iconize title icon] → title → [chips]
        const header = createDiv("ot-note-header ot-note-chipsrow");
        if (typePage) this.renderTypePageHeader(header, file, typePage, view);
        else this.renderNoteHeader(header, file, typeKey, fnFolder, view);
        const anchor = title.parentElement?.classList.contains("iconize-inline-title-wrapper") ? title.parentElement : title;
        const banner = header.querySelector(":scope > .ot-banner");
        if (banner) {
          const top = createDiv("ot-note-header ot-note-top");
          top.appendChild(banner);
          const icon = anchor.previousElementSibling?.classList.contains("iconize-title-icon") ? anchor.previousElementSibling : null;
          (icon || anchor).before(top);
        }
        anchor.after(header);
        const own = !anchor.previousElementSibling?.classList.contains("iconize-title-icon") && this.settings.noteIcons?.[file.path];
        if (own) {
          const pi = createDiv("ot-note-header ot-page-icon");
          pi.style.setProperty("--ot-color", own.color && own.color !== NO_COLOR ? own.color : "var(--text-normal)");
          setIcon(pi, own.icon);
          anchor.before(pi);
        }
      });
    }
    if (this.settings.showRelated) {
      const groups = this.relatedGroups(file);
      if (groups.length) {
        const targets = [
          root.querySelector(".markdown-source-view .cm-sizer"),
          root.querySelector(".markdown-reading-view .mod-footer"),
        ];
        for (const t of targets) {
          if (!t) continue;
          const sec = createDiv("ot-related");
          this.renderRelated(sec, file, groups, view);
          const bl = t.querySelector(":scope > .embedded-backlinks");
          if (t.classList.contains("mod-footer")) t.prepend(sec);
          else if (bl) bl.before(sec);
          else t.append(sec);
        }
      }
    }
  }

  renderTypePageHeader(header, file, key, view) {
    const color = this.colorFor(key);
    const rule = !this.settings.hideIconizeOnTypePages && !this.settings.iconizeHintDismissed ? this.iconizeRuleFor(file) : null;
    if (rule) {
      const hint = header.createDiv("ot-hint");
      setIcon(hint.createSpan("ot-hint-icon"), "info");
      const tx = hint.createDiv("ot-hint-text");
      tx.createSpan({ text: `The icon above the title comes from your Iconize rule “${rule.rule}”, which also matches “${file.basename}”. ` });
      tx.createSpan({ cls: "ot-hint-sub", text: "Hide it on type pages, or narrow the rule in Iconize (e.g. ^" + rule.rule + "$)." });
      const acts = hint.createDiv("ot-hint-acts");
      const btn = (text, fn, cta) => { const b = acts.createEl("button", { text, cls: cta ? "mod-cta" : "" }); b.onclick = fn; };
      btn("Hide on type pages", async () => { this.settings.hideIconizeOnTypePages = true; await this.saveSettings(false); this.decorateAll(); }, true);
      btn("Open Iconize settings", () => { try { this.app.setting.open(); this.app.setting.openTabById("obsidian-icon-folder"); } catch (e) {} });
      btn("Don't show again", async () => { this.settings.iconizeHintDismissed = true; await this.saveSettings(false); this.decorateAll(); });
    }
    if (this.settings.showBanner) {
      const src = this.thumbnailFor(file, true);
      if (src) this.bannerImage(header, src, file.path, file);
      else this.drawTypeBanner(header, key);
    }
    const chips = header.createDiv("ot-chips");
    const openInNav = () => this.activateView().then(() => this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view?.select(key, { noOpen: true }));
    const tchip = chips.createDiv("ot-chip ot-type-chip");
    tchip.style.setProperty("--ot-color", color);
    setIcon(tchip.createSpan("ot-chip-icon"), this.iconFor(key));
    tchip.createSpan({ text: "Object type" });
    tchip.onclick = openInNav;
    const n = this.filesFor(key).length, folders = this.typeFolders(key).length;
    const fchip = chips.createDiv("ot-chip ot-folder-chip");
    setIcon(fchip.createSpan("ot-chip-icon"), "files");
    fchip.createSpan({ text: `${n} notes` });
    if (folders > 1) { fchip.createSpan({ cls: "ot-dot", text: "·" }); fchip.createSpan({ text: `${folders} folders` }); }
    fchip.onclick = openInNav;
    const add = chips.createDiv("ot-chip ot-folder-chip");
    setIcon(add.createSpan("ot-chip-icon"), "plus");
    add.createSpan({ text: `New ${this.labelFor(key)}` });
    add.onclick = () => this.createObject(key);
    const edit = chips.createDiv("ot-chip-btn");
    setIcon(edit, "palette");
    edit.setAttr("aria-label", "Icon, colour & folders");
    edit.onclick = () => new TypeConfigModal(this, key, () => this.decorateAll()).open();
  }

  renderNoteHeader(header, file, typeKey, fnFolder = null, view = null) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const fstyle = fnFolder ? this.folderStyle(fnFolder.path) : null;
    const color = fstyle?.color || (typeKey ? this.colorFor(typeKey) : "var(--ot-accent)");
    if (this.settings.showBanner) {
      const src = this.thumbnailFor(file, true);
      if (src) this.bannerImage(header, src, file.path, file);
      else if (fnFolder) {
        // folder notes without a cover get a generated banner in the type colour
        const b = header.createDiv("ot-banner ot-banner-generated");
        b.style.setProperty("--ot-color", color);
        setIcon(b.createDiv("ot-banner-glyph"), fstyle?.icon || "folder-open");
        const crumbs = b.createDiv("ot-banner-path");
        crumbs.setText(fnFolder.path.split("/").join("  ›  "));
      } else if (this.usesDefaultBanner(file)) this.drawDefaultBanner(header, file);
    }
    const chips = header.createDiv("ot-chips");
    const openInNav = (k) => this.activateView().then(() => this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view?.select(k));
    for (const tk of this.typesOfFile(file)) {
      const tchip = chips.createDiv("ot-chip ot-type-chip");
      tchip.style.setProperty("--ot-color", this.colorFor(tk));
      setIcon(tchip.createSpan("ot-chip-icon"), this.iconFor(tk));
      tchip.createSpan({ text: this.labelFor(tk) });
      tchip.onclick = () => openInNav(tk);
    }
    if (fnFolder) {
      const notes = [], subs = fnFolder.children.filter((c) => !c.extension).length;
      const walk = (fo) => fo.children.forEach((c) => c.extension ? (c.extension === "md" && c !== file && !this.isFolderNote(c) && notes.push(c)) : walk(c));
      walk(fnFolder);
      const fchip = chips.createDiv("ot-chip ot-folder-chip");
      setIcon(fchip.createSpan("ot-chip-icon"), fstyle?.icon || "folder");
      if (fstyle?.color) fchip.style.setProperty("--ot-color", fstyle.color), fchip.addClass("has-color");
      fchip.createSpan({ text: `${notes.length} notes` });
      if (subs) { fchip.createSpan({ cls: "ot-dot", text: "·" }); fchip.createSpan({ text: `${subs} folders` }); }
      if (typeKey) fchip.onclick = () => openInNav(this.folderKey(typeKey, fnFolder.path));
    }

    const cols = [];
    const push = (v) => { for (const x of Array.isArray(v) ? v : [v]) if (x != null && x !== "") cols.push(cleanLink(x)); };
    if (fm.collections) push(fm.collections);
    else if (fm.tags) push(fm.tags);
    // properties: show / edit them right here
    this.propsOpen ||= new Set();
    const nProps = Object.keys(fm).filter((k) => k !== "position").length;
    const open = !this.settings.hideProperties || this.propsOpen.has(file.path);
    view?.containerEl.toggleClass("ot-show-props", open);
    const pbtn = chips.createDiv("ot-chip ot-props-chip" + (open ? " is-open" : ""));
    setIcon(pbtn.createSpan("ot-chip-icon"), "list");
    pbtn.createSpan({ text: nProps ? `${nProps} properties` : "Add property" });
    pbtn.setAttr("aria-label", open ? "Hide properties" : "Show and edit properties");
    pbtn.onclick = () => {
      const willOpen = !view?.containerEl.hasClass("ot-show-props");
      willOpen ? this.propsOpen.add(file.path) : this.propsOpen.delete(file.path);
      view?.containerEl.toggleClass("ot-show-props", willOpen);
      pbtn.toggleClass("is-open", willOpen);
      pbtn.setAttr("aria-label", willOpen ? "Hide properties" : "Show and edit properties");
      if (willOpen && !nProps) this.app.commands.executeCommandById("markdown:add-metadata-property");
    };

    const ibtn = chips.createDiv("ot-chip-btn");
    const hasIcon = !!(this.iconizeInfo(fnFolder ? fnFolder.path : file.path) || this.settings.noteIcons?.[file.path]
      || (fnFolder && typeKey && this.settings.types[this.folderKey(typeKey, fnFolder.path)]?.icon));
    setIcon(ibtn, hasIcon ? "smile" : "smile-plus");
    ibtn.setAttr("aria-label", fnFolder ? "Folder icon" : hasIcon ? "Change icon" : "Add icon");
    ibtn.onclick = () => {
      if (fnFolder && typeKey) new TypeConfigModal(this, this.folderKey(typeKey, fnFolder.path), () => this.afterIconChange(file)).open();
      else new NoteIconModal(this, file).open();
    };

    const hasBanner = !!this.bannerKey(file) || (this.usesDefaultBanner(file) && !!this.defaultBannerSource(file));
    const bbtn = chips.createDiv("ot-chip-btn");
    setIcon(bbtn, hasBanner ? "image" : "image-plus");
    bbtn.setAttr("aria-label", hasBanner ? "Banner" : "Add banner");
    bbtn.onclick = (evt) => {
      if (!hasBanner) return new BannerPickerModal(this, file).open();
      const m = new Menu();
      const box = view?.containerEl.querySelector(".ot-banner");
      const bpath = box?.dataset.bannerPath;
      if (box && bpath) {
        const st = this.bannerStyle(bpath);
        m.addItem((i) => i.setTitle("Fill").setIcon("maximize").setChecked(st.fit === "fill").onClick(async () => { await this.setBannerStyle(bpath, { fit: "fill" }); this.applyBannerStyle(box, bpath); }));
        m.addItem((i) => i.setTitle("Fit").setIcon("minimize").setChecked(st.fit === "fit").onClick(async () => { await this.setBannerStyle(bpath, { fit: "fit" }); this.applyBannerStyle(box, bpath); }));
        if (st.fit === "fill") m.addItem((i) => i.setTitle("Reposition").setIcon("move").onClick(() => this.repositionBanner(box, bpath)));
        m.addSeparator();
      }
      m.addItem((i) => i.setTitle("Change banner").setIcon("image").onClick(() => new BannerPickerModal(this, file).open()));
      m.addItem((i) => i.setTitle("Remove banner").setIcon("trash-2").onClick(async () => {
        if (this.usesDefaultBanner(file)) await this.setDefaultBanner(file, false);
        if (this.bannerKey(file)) await this.setBanner(file, null);
      }));
      m.showAtMouseEvent(evt);
    };
    if (cols.length) {
      const cchip = chips.createDiv("ot-chip ot-collections-chip");
      setIcon(cchip.createSpan("ot-chip-icon"), "arrow-right-left");
      cols.forEach((c, i) => {
        if (i) cchip.createSpan({ cls: "ot-dot", text: "·" });
        const s = cchip.createSpan({ cls: "ot-collection", text: c.split("/").pop() });
        s.onclick = () => {
          const linked = this.app.metadataCache.getFirstLinkpathDest(c, file.path);
          if (linked) this.app.workspace.getLeaf(false).openFile(linked);
          else this.app.internalPlugins?.getPluginById?.("global-search")?.instance?.openGlobalSearch(`tag:#${c}`);
        };
      });
    }
  }

  /** notes set to "Default banner" show their nearest object type's banner (kept in settings, not in the note) */
  usesDefaultBanner(file) { return !!(file && this.settings.defaultBanners?.[file.path]); }
  /** banners a note can borrow, nearest first: folder notes above it that have an image banner, then its object types */
  bannerSources(file) {
    const out = [];
    if (!file) return out;
    for (let fo = file.parent; fo && fo.path !== "/"; fo = fo.parent) {
      const fn = this.folderNoteOf(fo.path);
      if (!fn || fn === file) continue;
      const src = this.thumbnailFor(fn, true);
      if (src) out.push({ id: "note:" + fn.path, label: fo.name, kind: "Folder banner", src, file: fn });
    }
    for (const tk of this.typesOfFile(file)) {
      const b = this.typeBanner(tk);
      out.push({ id: "type:" + tk, label: this.labelFor(tk), kind: "Object type banner", src: b.src, typeKey: tk, banner: b });
    }
    return out;
  }
  defaultBannerSource(file) {
    const want = this.settings.defaultBanners?.[file.path];
    if (!want) return null;
    const all = this.bannerSources(file);
    return all.find((x) => x.id === want) || all.find((x) => x.typeKey) || all[0] || null;
  }
  drawDefaultBanner(parent, file) {
    const src = this.defaultBannerSource(file);
    if (!src) return false;
    if (src.typeKey) this.drawTypeBanner(parent, src.typeKey);
    else this.bannerImage(parent, src.src, src.file.path, src.file);
    return true;
  }
  async setDefaultBanner(file, on) {
    this.settings.defaultBanners ||= {};
    if (on) this.settings.defaultBanners[file.path] = typeof on === "string" ? on : true;
    else delete this.settings.defaultBanners[file.path];
    await this.saveSettings(false);
    this.afterIconChange(file);
  }
  /** the banner an object type's page shows: its page's cover image, or the generated one in the type colour */
  typeBanner(key) {
    const page = this.app.vault.getAbstractFileByPath(this.typeNotePath(key));
    const src = page ? this.thumbnailFor(page, true) : null;
    return { key, src, page, color: this.colorFor(key), icon: this.iconFor(key), text: this.typeFolders(key).join("  ·  ") || "Object type" };
  }
  drawTypeBanner(parent, key) {
    const b = this.typeBanner(key);
    if (b.src) { this.bannerImage(parent, b.src, b.page.path, b.page); return; }
    const el = parent.createDiv("ot-banner ot-banner-generated");
    el.style.setProperty("--ot-color", b.color);
    setIcon(el.createDiv("ot-banner-glyph"), b.icon);
    el.createDiv({ cls: "ot-banner-path", text: b.text });
  }

  /* ── banner fill / fit / position (per note, kept in settings) ── */
  bannerStyle(path) { return Object.assign({ fit: "fill", x: 50, y: 50 }, this.settings.bannerStyles?.[path] || {}); }
  async setBannerStyle(path, patch) {
    this.settings.bannerStyles ||= {};
    const next = Object.assign(this.bannerStyle(path), patch);
    if (next.fit === "fill" && next.x === 50 && next.y === 50) delete this.settings.bannerStyles[path];
    else this.settings.bannerStyles[path] = next;
    await this.saveData(this.settings);
  }
  applyBannerStyle(box, path) {
    const st = this.bannerStyle(path), img = box.querySelector("img");
    box.toggleClass("is-fit", st.fit === "fit");
    if (img) img.style.setProperty("object-position", `${st.x}% ${st.y}%`, "important");
  }
  bannerImage(parent, src, path, file) {
    const box = parent.createDiv("ot-banner");
    box.createEl("img", { attr: { src } });
    box.dataset.bannerPath = path;
    this.applyBannerStyle(box, path);
    box.oncontextmenu = (evt) => { evt.preventDefault(); this.bannerMenu(evt, box, path, file); };
    return box;
  }
  bannerMenu(evt, box, path, file) {
    const st = this.bannerStyle(path);
    const m = new Menu();
    m.addItem((i) => i.setTitle("Fill").setIcon("maximize").setChecked(st.fit === "fill").onClick(async () => { await this.setBannerStyle(path, { fit: "fill" }); this.applyBannerStyle(box, path); }));
    m.addItem((i) => i.setTitle("Fit").setIcon("minimize").setChecked(st.fit === "fit").onClick(async () => { await this.setBannerStyle(path, { fit: "fit" }); this.applyBannerStyle(box, path); }));
    if (st.fit === "fill") m.addItem((i) => i.setTitle("Reposition").setIcon("move").onClick(() => this.repositionBanner(box, path)));
    if (st.x !== 50 || st.y !== 50) m.addItem((i) => i.setTitle("Reset position").setIcon("rotate-ccw").onClick(async () => { await this.setBannerStyle(path, { x: 50, y: 50 }); this.applyBannerStyle(box, path); }));
    if (file && file.path === path && this.bannerKey(file)) {
      m.addSeparator();
      m.addItem((i) => i.setTitle("Change banner").setIcon("image").onClick(() => new BannerPickerModal(this, file).open()));
      m.addItem((i) => i.setTitle("Remove banner").setIcon("trash-2").onClick(() => this.setBanner(file, null)));
    }
    m.showAtMouseEvent(evt);
  }
  /** drag the image inside the banner (mouse or touch), then Save */
  repositionBanner(box, path) {
    const img = box.querySelector("img");
    if (!img || box.hasClass("is-repositioning")) return;
    const start = this.bannerStyle(path);
    let { x, y } = start;
    box.addClass("is-repositioning");
    const bar = box.createDiv("ot-banner-reposition");
    bar.createSpan({ cls: "ot-banner-reposition-hint", text: "Drag the image to reposition" });
    const cancel = bar.createEl("button", { text: "Cancel" });
    const save = bar.createEl("button", { cls: "mod-cta", text: "Save" });
    const finish = async (keep) => {
      box.removeClass("is-repositioning");
      bar.remove();
      box.onpointerdown = null;
      if (keep) await this.setBannerStyle(path, { x: Math.round(x), y: Math.round(y) });
      else ({ x, y } = start);
      this.applyBannerStyle(box, path);
    };
    cancel.onclick = (e) => { e.stopPropagation(); finish(false); };
    save.onclick = (e) => { e.stopPropagation(); finish(true); };
    box.onpointerdown = (e) => {
      if (e.target.closest(".ot-banner-reposition")) return;
      e.preventDefault();
      try { box.setPointerCapture(e.pointerId); } catch (err) {}
      const bw = box.clientWidth, bh = box.clientHeight;
      const nw = img.naturalWidth || bw, nh = img.naturalHeight || bh;
      const scale = Math.max(bw / nw, bh / nh);
      const overX = nw * scale - bw, overY = nh * scale - bh; // how far the covered image overflows the box
      const sx = e.clientX, sy = e.clientY, x0 = x, y0 = y;
      const move = (ev) => {
        if (overX > 1) x = Math.min(100, Math.max(0, x0 - ((ev.clientX - sx) / overX) * 100));
        if (overY > 1) y = Math.min(100, Math.max(0, y0 - ((ev.clientY - sy) / overY) * 100));
        img.style.setProperty("object-position", `${x}% ${y}%`, "important");
      };
      const up = () => { box.removeEventListener("pointermove", move); box.removeEventListener("pointerup", up); box.removeEventListener("pointercancel", up); };
      box.addEventListener("pointermove", move);
      box.addEventListener("pointerup", up);
      box.addEventListener("pointercancel", up);
    };
  }

  bannerKey(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    return THUMB_KEYS.find((k) => this.resolveImage(fm[k], file.path)) || null;
  }

  async setBanner(file, value) {
    if (value != null && this.usesDefaultBanner(file)) { delete this.settings.defaultBanners[file.path]; await this.saveData(this.settings); }
    const existing = this.bannerKey(file);
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (value == null) { if (existing) delete fm[existing]; }
      else fm[existing || "cover"] = value;
    });
  }

  relatedGroups(file) {
    const groups = new Map();
    for (const src of this.backlinksOf(file)) {
      const key = this.typeOfFile(src);
      if (!key || this.settings.types[key]?.hidden) continue;
      if (!groups.has(key)) groups.set(key, { key, files: [], backKey: null });
      const g = groups.get(key);
      g.files.push(src);
      if (!g.backKey) {
        const fl = this.app.metadataCache.getFileCache(src)?.frontmatterLinks || [];
        const hit = fl.find((l) => this.app.metadataCache.getFirstLinkpathDest(l.link, src.path) === file);
        if (hit) g.backKey = hit.key.replace(/\.\d+$/, "");
      }
    }
    return [...groups.values()].sort((a, b) => b.files.length - a.files.length);
  }

  subtitleFor(file, skipKey) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const parts = [];
    for (const [k, v] of Object.entries(fm)) {
      if (k === this.prop || k === skipKey || HIDDEN_SUBTITLE_KEYS.includes(k.toLowerCase())) continue;
      if (typeof v !== "string" && typeof v !== "number") continue;
      const s = String(v).trim();
      if (!s || s.length > 28 || /^\[\[|^https?:/.test(s)) continue;
      parts.push(s);
      if (parts.length === 2) break;
    }
    return parts.join(" · ");
  }

  renderRelated(sec, file, groups, view) {
    const state = (view._otRelated ||= { tab: null, sort: "name" });
    if (!groups.some((g) => g.key === state.tab)) state.tab = groups[0].key;

    const bar = sec.createDiv("ot-rel-tabs");
    const body = sec.createDiv("ot-rel-grid");
    const draw = () => {
      bar.empty(); body.empty();
      for (const g of groups) {
        const t = bar.createDiv("ot-rel-tab");
        if (g.key === state.tab) t.addClass("is-active");
        t.createSpan({ cls: "ot-rel-tab-label", text: this.labelFor(g.key) });
        let meta = String(g.files.length);
        if (g.key === state.tab) {
          const years = g.files.map((f) => {
            const fm = this.app.metadataCache.getFileCache(f)?.frontmatter || {};
            for (const v of Object.values(fm)) { const m = /^(\d{4})\b/.exec(String(v)); if (m) return +m[1]; }
            return null;
          }).filter(Boolean);
          if (years.length > 1) meta += ` · ${Math.min(...years)}–${Math.max(...years)}`;
        }
        t.createSpan({ cls: "ot-rel-tab-count", text: meta });
        t.onclick = () => { state.tab = g.key; draw(); };
      }
      bar.createDiv("ot-spacer");
      const g = groups.find((x) => x.key === state.tab);
      const open = bar.createDiv("ot-rel-open");
      setIcon(open.createSpan(), "arrow-up-right");
      open.createSpan({ text: this.labelFor(g.key) });
      open.onclick = () => this.activateView().then(() => this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view?.select(g.key));
      const sort = bar.createDiv("clickable-icon ot-rel-btn");
      setIcon(sort, "arrow-up-down");
      sort.setAttr("aria-label", state.sort === "name" ? "Sorted by name" : "Sorted by modified");
      sort.onclick = () => { state.sort = state.sort === "name" ? "modified" : "name"; draw(); };

      const files = [...g.files].sort(state.sort === "name"
        ? (a, b) => a.basename.localeCompare(b.basename)
        : (a, b) => b.stat.mtime - a.stat.mtime);
      for (const f of files) {
        const card = body.createDiv("ot-card");
        const cover = card.createDiv("ot-card-cover");
        const src = this.thumbnailFor(f);
        if (src) cover.createEl("img", { attr: { src, loading: "lazy" } });
        else paintIcon(cover.createDiv("ot-card-placeholder"), this.iconFor(g.key), this.colorFor(g.key));
        const txt = card.createDiv("ot-card-text");
        txt.createDiv({ cls: "ot-card-title", text: f.basename });
        const sub = this.subtitleFor(f, g.backKey);
        if (sub) txt.createDiv({ cls: "ot-card-sub", text: sub });
        card.onclick = (evt) => this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(f);
        card.onmouseover = (evt) => this.app.workspace.trigger("hover-link", {
          event: evt, source: "preview", hoverParent: view, targetEl: card, linktext: f.path,
        });
      }
      const add = body.createDiv("ot-card ot-card-add");
      setIcon(add.createDiv("ot-card-add-icon"), "plus");
      add.createDiv({ text: `Add ${this.labelFor(g.key).toLowerCase()}` });
      add.onclick = () => this.createObject(g.key, { [g.backKey || "related"]: `[[${file.basename}]]` });
    };
    draw();
  }

  updateStatus() {
    const el = this.statusEl;
    if (!el) return;
    el.empty();
    const file = this.app.workspace.getActiveFile();
    if (!file || file.extension !== "md") return;
    const bl = this.backlinksOf(file).length;
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    const np = Object.keys(fm).filter((k) => k !== "position").length;
    el.createSpan({ cls: "ot-status-item", text: `${bl} backlink${bl === 1 ? "" : "s"}` });
    const p = el.createSpan({ cls: "ot-status-item ot-status-props", text: `${np} propert${np === 1 ? "y" : "ies"}` });
    p.setAttr("aria-label", this.propsVisible ? "Hide properties" : "Show properties");
    p.onclick = () => this.toggleProps();
  }

  /* ───────── link type icons ───────── */
  linkIconFor(linktext, sourcePath) {
    const id = sourcePath + "\u0000" + linktext;
    const m = (this._linkInfo ||= new Map());
    if (m.has(id)) return m.get(id);
    const dest = this.app.metadataCache.getFirstLinkpathDest(linktext.split(/[#^|]/)[0], sourcePath);
    const key = dest && this.typeOfFile(dest);
    const info = key ? { icon: this.iconFor(key), color: this.colorFor(key), key } : null;
    m.set(id, info);
    return info;
  }

  addLinkIconsToDom(el, sourcePath) {
    el.querySelectorAll("a.internal-link").forEach((a) => {
      if (a.querySelector(".ot-link-icon")) return;
      const info = this.linkIconFor(a.getAttr("data-href") || a.textContent, sourcePath);
      if (!info) return;
      const s = createSpan("ot-link-icon");
      s.style.setProperty("--ot-color", info.color);
      setIcon(s, info.icon);
      a.prepend(s);
    });
  }

  linkIconExtension() {
    const plugin = this;
    class IconWidget extends WidgetType {
      constructor(info) { super(); this.info = info; }
      eq(o) { return o.info.icon === this.info.icon && o.info.color === this.info.color; }
      toDOM() {
        const s = createSpan("ot-link-icon");
        s.style.setProperty("--ot-color", this.info.color);
        setIcon(s, this.info.icon);
        return s;
      }
      ignoreEvent() { return false; }
    }
    const re = /\[\[([^\]|#^]+)[^\]]*\]\]/g;
    const build = (view) => {
      const b = new RangeSetBuilder();
      if (!plugin.settings.linkIcons) return b.finish();
      const info = editorInfoField ? view.state.field(editorInfoField, false) : null;
      const sourcePath = info?.file?.path || "";
      for (const { from, to } of view.visibleRanges) {
        const text = view.state.doc.sliceString(from, to);
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(text))) {
          if (from + m.index > 0 && view.state.doc.sliceString(from + m.index - 1, from + m.index) === "!") continue;
          const li = plugin.linkIconFor(m[1], sourcePath);
          if (li) b.add(from + m.index, from + m.index, Decoration.widget({ widget: new IconWidget(li), side: -1 }));
        }
      }
      return b.finish();
    };
    return ViewPlugin.fromClass(class {
      constructor(view) { this.decorations = build(view); }
      update(u) { if (u.docChanged || u.viewportChanged || u.transactions.some((t) => t.reconfigured)) this.decorations = build(u.view); }
    }, { decorations: (v) => v.decorations });
  }
}

/* ───────────────────────────── Navigator view ───────────────────────────── */

class HomeView extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.plugin = plugin; }
  getViewType() { return HOME_VIEW; }
  getDisplayText() { return "Home"; }
  getIcon() { return "house"; }
  async onOpen() {
    this.contentEl.addClass("ot-home-root");
    this.render();
    this.registerInterval(window.setInterval(() => { this._greet = null; this.render(); }, 15 * 60 * 1000));
  }

  recentFiles(limit) {
    const p = this.plugin;
    const bases = normalizePath(p.settings.basesFolder || "Typefold") + "/";
    return this.app.vault.getMarkdownFiles()
      .filter((f) => !f.path.startsWith(bases) && !p.isFolderNote(f) && !p.isTemplate(f) && !p.isArchived(f.path))
      .sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, limit);
  }

  render() {
    const p = this.plugin;
    const el = this.contentEl;
    const scrollTop = el.scrollTop;
    el.empty();
    const wrap = el.createDiv("ot-home");

    /* header */
    const head = wrap.createDiv("ot-home-head");
    const hl = head.createDiv();
    const helloEl = hl.createDiv({ cls: "ot-home-hello", text: this.greeting() });
    helloEl.setAttr("aria-label", "Click for another greeting");
    helloEl.onclick = () => { this._greet = null; helloEl.setText(this.greeting()); };
    const sub = hl.createDiv("ot-home-date");
    sub.createSpan({ text: moment().format("dddd, MMMM D") });
    if (p.settings.showWeather && p.settings.weatherLat != null && p.settings.weatherLon != null) {
      const w = sub.createSpan("ot-home-weather");
      this.weather().then((wx) => {
        if (!wx) return w.remove();
        w.setText(`  ·  ${wx.emoji} ${Math.round(wx.temp)}°  ${p.settings.weatherPlace || ""}`);
        if (!this._greetWx) { this._greetWx = true; this._greet = null; helloEl.setText(this.greeting()); }
      });
    }
    const actions = head.createDiv("ot-home-actions");
    const sb = actions.createDiv("ot-search-btn ot-home-search");
    setIcon(sb.createSpan("ot-search-icon"), "search");
    sb.createSpan({ cls: "ot-search-label", text: "Search notes" });
    if (p.settings.newTabSearch) sb.createSpan({ cls: "ot-kbd", text: "⌘T" });
    sb.onclick = () => new QuickOpenModal(p, null).open();
    const nb = actions.createDiv("ot-new-btn");
    setIcon(nb.createSpan(), "plus");
    nb.createSpan({ text: "New" });
    nb.onclick = () => p.newObjectFlow();

    /* object types */
    const sec1 = wrap.createDiv("ot-home-section ot-home-sec-types");
    const t1 = sec1.createDiv("ot-home-title");
    t1.createSpan({ text: "Object types" });
    const toggleOnHome = async (key) => {
      const c = p.conf(key);
      if (c.hideOnHome) delete c.hideOnHome; else c.hideOnHome = true;
      await p.saveSettings(false);
      p.refreshViews();
    };
    this.sectionMenu(t1, [
      ["Notes per card", [0, 1, 3, 5].map((n) => [n ? `${n}` : "None", () => this.setHome({ typeNotes: n }), this.hs().typeNotes === n])],
      ["Show on Home", p.visibleTypes().map((t) => [t.label, () => toggleOnHome(t.key), !p.settings.types[t.key]?.hideOnHome])],
    ]);
    const grid = sec1.createDiv("ot-home-types");
    for (const t of p.visibleTypes().filter((x) => !p.settings.types[x.key]?.hideOnHome)) {
      const card = grid.createDiv("ot-home-type");
      card.style.setProperty("--ot-color", p.colorFor(t.key));
      const top = card.createDiv("ot-home-type-top");
      paintIcon(top.createSpan("ot-home-type-icon"), p.iconFor(t.key), p.colorFor(t.key));
      const nm = top.createDiv("ot-home-type-name");
      nm.createDiv({ text: t.label });
      const files = p.filesFor(t.key);
      nm.createDiv({ cls: "ot-home-type-count", text: `${files.length} notes` });
      const add = top.createDiv("clickable-icon ot-home-type-add");
      setIcon(add, "plus");
      add.setAttr("aria-label", `New ${t.label}`);
      add.onclick = (e) => { e.stopPropagation(); p.createObject(t.key); };
      const recent = card.createDiv("ot-home-type-recent");
      const nNotes = this.hs().typeNotes;
      if (!nNotes) recent.remove();
      [...files].sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, nNotes).forEach((f) => {
        const r = recent.createDiv({ cls: "ot-home-type-note", text: f.basename });
        r.onclick = (e) => { e.stopPropagation(); this.plugin.openFromPanel(f, e); };
      });
      if (!files.length && nNotes) recent.createDiv({ cls: "ot-home-type-note is-empty", text: "No notes yet" });
      card.onclick = () => {
        p.openTypeBase(t.key);
        p.activateView(false).then(() => p.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view?.select?.(t.key, { noOpen: true }));
      };
    }
    const addType = grid.createDiv("ot-home-type ot-home-type-new");
    setIcon(addType.createDiv("ot-home-type-new-icon"), "plus");
    addType.createDiv({ text: "New type" });
    addType.onclick = () => new NewTypeModal(p).open();

    /* pinned */
    const pins = p.settings.pinned.map((x) => x.kind === "note" && this.app.vault.getAbstractFileByPath(x.id)).filter(Boolean);
    if (pins.length) {
      const sec = wrap.createDiv("ot-home-section ot-home-sec-pinned");
      sec.createDiv({ cls: "ot-home-title", text: "Pinned" });
      const g = sec.createDiv("ot-home-recent");
      pins.forEach((f) => this.noteCard(g, f));
    }

    /* recently edited */
    const hs = this.hs();
    const sec2 = wrap.createDiv("ot-home-section ot-home-sec-recent");
    const t2 = sec2.createDiv("ot-home-title");
    t2.createSpan({ text: "Recently edited" });
    const vt = t2.createDiv("ot-home-viewtoggle");
    for (const [v, ic, tip] of [["list", "list", "List"], ["cards", "layout-grid", "Cards"]]) {
      const b = vt.createDiv("clickable-icon" + (hs.recentView === v ? " is-active" : ""));
      setIcon(b, ic); b.setAttr("aria-label", tip);
      b.onclick = () => this.setHome({ recentView: v });
    }
    this.sectionMenu(t2, [
      ["Show", [8, 12, 20, 40].map((n) => [`${n} notes`, () => this.setHome({ recentCount: n }), hs.recentCount === n])],
      ["Type tags", [["Show", () => this.setHome({ showTypeChips: true }), hs.showTypeChips], ["Hide", () => this.setHome({ showTypeChips: false }), !hs.showTypeChips]]],
    ]);
    const files = this.recentFiles(hs.recentCount);
    if (hs.recentView === "cards") {
      const rg = sec2.createDiv("ot-home-recent");
      files.forEach((f) => this.noteCard(rg, f));
    } else {
      const lg = sec2.createDiv("ot-home-list");
      files.forEach((f) => this.noteRow(lg, f));
    }
    el.scrollTop = scrollTop;
  }

  hs() { return Object.assign({ recentView: "list", recentCount: 12, typeNotes: 3, showTypeChips: true }, this.plugin.settings.home || {}); }
  async setHome(patch) {
    this.plugin.settings.home = Object.assign(this.hs(), patch);
    await this.plugin.saveSettings(false);
    this.render();
  }
  sectionMenu(titleEl, groups) {
    const b = titleEl.createDiv("clickable-icon ot-home-more");
    setIcon(b, "sliders-horizontal");
    b.setAttr("aria-label", "View options");
    b.onclick = (e) => {
      const m = new Menu();
      groups.forEach(([label, items], gi) => {
        if (gi) m.addSeparator();
        m.addItem((i) => i.setTitle(label).setDisabled(true));
        for (const [t, fn, on] of items) m.addItem((i) => i.setTitle(t).setChecked(!!on).onClick(fn));
      });
      m.showAtMouseEvent(e);
    };
  }

  typeChips(parent, f) {
    const p = this.plugin;
    for (const tk of p.typesOfFile(f)) {
      const chip = parent.createSpan("ot-home-mini-chip");
      chip.style.setProperty("--ot-color", p.colorFor(tk));
      setIcon(chip.createSpan(), p.iconFor(tk));
      chip.createSpan({ text: p.labelFor(tk) });
    }
  }

  noteRow(parent, f) {
    const p = this.plugin;
    const row = parent.createDiv("ot-home-row");
    const tk = p.typeOfFile(f);
    paintIcon(row.createSpan("ot-home-row-icon"), tk ? p.iconFor(tk) : "file-text", tk ? p.colorFor(tk) : "#8E8E93");
    row.createSpan({ cls: "ot-home-row-title", text: f.basename });
    if (this.hs().showTypeChips) this.typeChips(row.createSpan("ot-home-row-chips"), f);
    row.createSpan({ cls: "ot-home-row-path", text: f.parent?.path === "/" ? "" : f.parent?.path });
    row.createSpan({ cls: "ot-home-time", text: moment(f.stat.mtime).fromNow() });
    row.onclick = (e) => this.plugin.openFromPanel(f, e);
    row.onmouseover = (e) => this.app.workspace.trigger("hover-link", { event: e, source: HOME_VIEW, hoverParent: this, targetEl: row, linktext: f.path });
  }

  /* ── greeting & weather ── */
  async weather() {
    const st = this.plugin.settings;
    const c = this.plugin._wx;
    if (c && Date.now() - c.at < 30 * 60 * 1000) return c;
    try {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${st.weatherLat}&longitude=${st.weatherLon}&current=temperature_2m,weather_code,is_day`;
      const j = (await requestUrl({ url })).json?.current;
      if (!j) return null;
      const code = j.weather_code;
      const kind = code === 0 ? "clear" : code <= 3 ? "cloudy" : code <= 48 ? "fog" : code <= 67 || (code >= 80 && code <= 82) ? "rain"
        : code <= 77 || code === 85 || code === 86 ? "snow" : "storm";
      const emoji = { clear: j.is_day ? "☀️" : "🌙", cloudy: "⛅️", fog: "🌫️", rain: "🌧️", snow: "❄️", storm: "⛈️" }[kind];
      this.plugin._wx = { at: Date.now(), kind, temp: j.temperature_2m, emoji };
      return this.plugin._wx;
    } catch (e) { return null; }
  }

  greeting() {
    if (this._greet) return this._greet;
    const name = (this.plugin.settings.userName || "").trim();
    const n = name ? `, ${name}` : "";
    const h = new Date().getHours();
    const day = moment().format("dddd");
    const pool = [];
    if (h < 5) pool.push(`Still up${n}?`, `Burning the midnight oil${n}?`, `Quiet hours${n} — good for deep work.`);
    else if (h < 9) pool.push(`Good morning${n}!`, `Rise and shine${n}!`, `Fresh start${n} ☕️`, `Early bird${n}!`);
    else if (h < 12) pool.push(`Good morning${n}!`, `Hope your morning's going well${n}.`, `Morning${n} — what's first?`);
    else if (h < 14) pool.push(`Good afternoon${n}!`, `Lunch break${n}? 🍜`, `Halfway through the day${n}.`);
    else if (h < 18) pool.push(`Good afternoon${n}!`, `Afternoon focus time${n}.`, `Keep it going${n}!`, `Coffee number two${n}? ☕️`);
    else if (h < 22) pool.push(`Good evening${n}!`, `Winding down${n}?`, `Evening${n} — nice work today.`);
    else pool.push(`Good night${n} 🌙`, `Late session${n}?`, `One more note before bed${n}?`);
    if (day === "Monday") pool.push(`New week${n}. Let's go!`);
    if (day === "Friday") pool.push(`Happy Friday${n}! 🎉`);
    if (day === "Saturday" || day === "Sunday") pool.push(`Happy ${day}${n}!`, `Weekend mode${n} 🌿`);
    const wx = this.plugin._wx;
    if (wx) {
      const t = Math.round(wx.temp);
      const byKind = {
        clear: [`Clear skies today${n} ☀️`, `Lovely weather${n} — ${t}° outside.`],
        cloudy: [`A cloudy one${n} ⛅️`, `Grey skies, bright ideas${n}.`],
        fog: [`Foggy out there${n} 🌫️`],
        rain: [`Rainy day${n} — perfect for reading 🌧️`, `Stay dry${n}! ☔️`],
        snow: [`Snow day${n}! ❄️`, `Stay warm${n} — it's snowing.`],
        storm: [`Stormy out there${n} ⛈️ Stay in and write.`],
      }[wx.kind] || [];
      pool.push(...byKind, ...byKind); // weather lines twice as likely
      if (t <= 0) pool.push(`Bundle up${n} — it's ${t}° 🧣`);
      if (t >= 28) pool.push(`Hot one today${n} (${t}°) 🥵`);
    }
    this._greet = pool[Math.floor(Math.random() * pool.length)];
    return this._greet;
  }

  noteCard(parent, f) {
    const p = this.plugin;
    const card = parent.createDiv("ot-card ot-home-card");
    const cover = card.createDiv("ot-card-cover");
    const tk = p.typeOfFile(f);
    const src = p.thumbnailFor(f);
    if (src) cover.createEl("img", { attr: { src, loading: "lazy" } });
    else paintIcon(cover.createDiv("ot-card-placeholder"), tk ? p.iconFor(tk) : "file-text", tk ? p.colorFor(tk) : "#8E8E93");
    if (tk) cover.style.setProperty("--ot-color", p.colorFor(tk));
    const txt = card.createDiv("ot-card-text");
    txt.createDiv({ cls: "ot-card-title", text: f.basename });
    const meta = txt.createDiv("ot-home-card-meta");
    if (this.hs().showTypeChips) this.typeChips(meta, f);
    meta.createSpan({ cls: "ot-home-time", text: moment(f.stat.mtime).fromNow() });
    card.onclick = (e) => this.plugin.openFromPanel(f, e);
    card.onmouseover = (e) => this.app.workspace.trigger("hover-link", { event: e, source: HOME_VIEW, hoverParent: this, targetEl: card, linktext: f.path });
  }
}

/* Home drawn inside a note's ```typefold-home``` block: same rendering as HomeView */
/* ───────────── Tasks: Month / Week / Day / List, for everything or one object type ───────────── */
class TasksView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.scope = "all";
    this.cursor = moment().startOf("day");
    this.collapsed = new Set(["done"]);
  }
  getViewType() { return TASKS_VIEW; }
  getDisplayText() { return this.scope === "all" ? "Tasks" : `${this.plugin.labelFor(this.scope)} · Tasks`; }
  getIcon() { return "circle-check"; }
  getState() { return { scope: this.scope, date: this.cursor.format("YYYY-MM-DD") }; }
  async setState(state, result) {
    if (state?.scope) this.scope = state.scope;
    if (state?.date) this.cursor = moment(state.date, "YYYY-MM-DD");
    await super.setState(state, result);
    this.leaf.updateHeader?.();
    this.render();
  }
  async onOpen() {
    this.contentEl.addClass("ot-tasks-root");
    this.render();
  }
  prefs() { return this.plugin.taskPrefs(this.scope); }
  async setPref(patch) {
    Object.assign(this.prefs(), patch);
    await this.plugin.saveSettings(false);
    this.render();
  }

  async render() {
    const seq = (this._seq = (this._seq || 0) + 1);
    const p = this.plugin;
    const tasks = (await p.collectTasks()).filter((t) => p.taskInType(t, this.scope));
    if (seq !== this._seq) return; // a newer render started meanwhile
    const pr = this.prefs();
    const mode = pr.mode || "list";
    const scrollTop = this.contentEl.querySelector(".ot-tasks-body")?.scrollTop || 0;
    const root = this.contentEl;
    root.empty();
    this.applyBackground(root, pr.bg);

    const wrap = root.createDiv("ot-tasks-wrap");
    const head = wrap.createDiv("ot-tasks-head");
    const title = head.createDiv("ot-tasks-title");
    paintIcon(title.createSpan(), this.scope === "all" ? "circle-check" : p.iconFor(this.scope), this.scope === "all" ? "#34C759" : p.colorFor(this.scope));
    const name = title.createSpan({ cls: "ot-tasks-name", text: this.scope === "all" ? "Tasks" : p.labelFor(this.scope) });
    setIcon(title.createSpan("ot-tasks-caret"), "chevron-down");
    title.setAttr("aria-label", "Choose object type");
    title.onclick = (evt) => this.scopeMenu(evt);
    const open = tasks.filter((t) => !t.done).length;
    head.createSpan({ cls: "ot-tasks-count", text: `${open} open` });
    head.createDiv("ot-spacer");
    const tn = p.settings.taskSource === "tasknotes" ? p.taskNotes() : null;
    if (tn) {
      const nb = head.createDiv("ot-tasks-new");
      setIcon(nb.createSpan(), "plus");
      nb.createSpan({ text: "New task" });
      nb.onclick = () => this.app.commands.executeCommandById("tasknotes:create-new-task");
    }
    const more = head.createDiv("clickable-icon ot-tasks-more");
    setIcon(more, "more-horizontal");
    more.setAttr("aria-label", "View options");
    more.onclick = (evt) => this.optionsMenu(evt);

    const bar = wrap.createDiv("ot-tasks-bar");
    const seg = bar.createDiv("ot-tasks-seg");
    for (const [m, label] of [["month", "Month"], ["week", "Week"], ["day", "Day"], ["list", "List"]]) {
      const b = seg.createDiv({ cls: "ot-tasks-seg-btn" + (m === mode ? " is-active" : ""), text: label });
      b.onclick = () => this.setPref({ mode: m });
    }
    if (mode !== "list") {
      const nav = bar.createDiv("ot-tasks-nav");
      const unit = mode === "month" ? "month" : mode === "week" ? "week" : "day";
      const step = (n) => { this.cursor = this.cursor.clone().add(n, unit); this.render(); };
      const prev = nav.createDiv("clickable-icon"); setIcon(prev, "chevron-left"); prev.onclick = () => step(-1);
      const today = nav.createDiv({ cls: "ot-tasks-today", text: "Today" });
      today.onclick = () => { this.cursor = moment().startOf("day"); this.render(); };
      const next = nav.createDiv("clickable-icon"); setIcon(next, "chevron-right"); next.onclick = () => step(1);
      nav.createDiv({ cls: "ot-tasks-period", text: this.periodLabel(mode) });
    }

    this.addBoxes = new Map();
    this.dateField = pr.dateField || "any";
    this.addTag = this.scope !== "all" && !/\s/.test(p.labelFor(this.scope)) ? p.labelFor(this.scope) : null;
    const body = wrap.createDiv(`ot-tasks-body ot-tasks-${mode}`);
    const shown = p.settings.taskShowDone ? tasks : tasks.filter((t) => !t.done);
    if (mode === "month") this.renderMonth(body, shown);
    else if (mode === "week") this.renderWeek(body, shown);
    else if (mode === "day") this.renderDay(body, shown);
    else this.renderList(body, tasks);
    if (!tasks.length) {
      const e = body.createDiv("ot-tasks-empty");
      e.setText(tn ? "No tasks here yet."
        : p.settings.taskSource === "tasknotes" ? "Task source is TaskNotes, but the TaskNotes plugin isn't enabled."
        : "No tasks yet. Write “- [ ] something” in any note.");
    }
    body.scrollTop = scrollTop;
  }

  applyBackground(root, bg) {
    root.toggleClass("has-bg", !!bg);
    root.style.removeProperty("--ot-tasks-bg-image");
    root.style.removeProperty("--ot-tasks-bg-color");
    if (!bg) return;
    if (bg.color) root.style.setProperty("--ot-tasks-bg-color", bg.color);
    if (bg.image) {
      let src = bg.image;
      if (!/^https?:\/\//.test(src)) {
        const f = this.app.vault.getAbstractFileByPath(src);
        src = f ? this.app.vault.getResourcePath(f) : null;
      }
      if (src) root.style.setProperty("--ot-tasks-bg-image", `url("${src.replace(/"/g, '\\"')}")`);
    }
  }

  periodLabel(mode) {
    const c = this.cursor;
    if (mode === "month") return c.format("MMMM YYYY");
    if (mode === "day") return c.format("dddd, MMM D");
    const s = this.weekStart(c), e = s.clone().add(6, "day");
    return s.isSame(e, "month") ? `${s.format("MMM D")} – ${e.format("D")}` : `${s.format("MMM D")} – ${e.format("MMM D")}`;
  }
  firstDay() {
    const fd = this.plugin.taskNotes()?.settings?.calendarViewSettings?.firstDay;
    return typeof fd === "number" ? fd : 1;
  }
  weekStart(d) {
    const fd = this.firstDay();
    return d.clone().startOf("day").subtract((d.day() - fd + 7) % 7, "day");
  }
  /** which date places a task: "due", "scheduled", or "any" (due, else scheduled) */
  dateOf(t) {
    const f = this.dateField || "any";
    return f === "due" ? t.due : f === "scheduled" ? t.scheduled : t.due || t.scheduled;
  }
  dateKind(t) {
    const f = this.dateField || "any";
    return f === "any" ? (t.due ? "due" : "scheduled") : f;
  }
  byDay(tasks) {
    const m = new Map();
    for (const t of tasks) {
      const d = this.dateOf(t);
      if (!d) continue;
      if (!m.has(d)) m.set(d, []);
      m.get(d).push(t);
    }
    for (const list of m.values()) list.sort((a, b) => (a.done - b.done) || String(a.time || "99").localeCompare(String(b.time || "99")));
    return m;
  }

  renderMonth(body, tasks) {
    const days = this.byDay(tasks);
    const today = moment().format("YYYY-MM-DD");
    const first = this.cursor.clone().startOf("month");
    const start = this.weekStart(first);
    const weeks = Math.ceil((first.diff(start, "days") + first.daysInMonth()) / 7);
    const grid = body.createDiv("ot-month");
    for (let i = 0; i < 7; i++) grid.createDiv({ cls: "ot-month-dow", text: start.clone().add(i, "day").format("ddd") });
    for (let i = 0; i < weeks * 7; i++) {
      const d = start.clone().add(i, "day"), key = d.format("YYYY-MM-DD");
      const cell = grid.createDiv("ot-month-cell");
      if (!d.isSame(first, "month")) cell.addClass("is-other");
      if (key === today) cell.addClass("is-today");
      cell.createDiv({ cls: "ot-month-num", text: String(d.date()) });
      const list = days.get(key) || [];
      const pills = cell.createDiv("ot-month-pills");
      for (const t of list.slice(0, 3)) this.pill(pills, t);
      if (list.length > 3) pills.createDiv({ cls: "ot-month-more", text: `+${list.length - 3} more` });
      if (list.length) {
        const dots = cell.createDiv("ot-month-dots");
        for (const t of list.slice(0, 4)) dots.createSpan({ cls: "ot-month-dot" + (t.done ? " is-done" : "") });
      }
      cell.onclick = (evt) => {
        if (evt.target.closest(".ot-task-pill")) return;
        this.cursor = d.clone();
        this.setPref({ mode: "day" });
      };
    }
  }

  renderWeek(body, tasks) {
    const days = this.byDay(tasks);
    const today = moment().format("YYYY-MM-DD");
    const start = this.weekStart(this.cursor);
    const cols = body.createDiv("ot-week");
    for (let i = 0; i < 7; i++) {
      const d = start.clone().add(i, "day"), key = d.format("YYYY-MM-DD");
      const col = cols.createDiv("ot-week-col");
      if (key === today) col.addClass("is-today");
      const h = col.createDiv("ot-week-head");
      h.createSpan({ cls: "ot-week-dow", text: d.format("ddd") });
      h.createSpan({ cls: "ot-week-num", text: String(d.date()) });
      h.onclick = () => { this.cursor = d.clone(); this.setPref({ mode: "day" }); };
      const list = col.createDiv("ot-week-list");
      for (const t of days.get(key) || []) this.taskRow(list, t, { compact: true, hideDate: true });
      this.addSlot("w-" + key, list, key);
      col.ondblclick = (evt) => { if (!evt.target.closest(".ot-task-row, .ot-task-add, .ot-week-head")) this.startAdd("w-" + key, key); };
    }
  }

  renderDay(body, tasks) {
    const key = this.cursor.format("YYYY-MM-DD");
    const isToday = this.cursor.isSame(moment(), "day");
    if (isToday) {
      const overdue = tasks.filter((t) => !t.done && this.dateOf(t) && this.dateOf(t) < key);
      if (overdue.length) this.group(body, "overdue", "Overdue", overdue, { warn: true });
    }
    const list = this.byDay(tasks).get(key) || [];
    this.group(body, "day", isToday ? "Today" : this.cursor.format("dddd"), list, { hideDate: true, always: true, addDate: key });
  }

  renderList(body, all) {
    const p = this.plugin;
    const today = moment().startOf("day");
    const key = (d) => d.format("YYYY-MM-DD");
    const t0 = key(today), t1 = key(today.clone().add(1, "day")), t7 = key(today.clone().add(7, "day"));
    const open = all.filter((t) => !t.done);
    const sortD = (a, b) => String(this.dateOf(a)).localeCompare(String(this.dateOf(b))) || String(a.time || "99").localeCompare(String(b.time || "99"));
    const g = (fn) => open.filter(fn).sort(sortD);
    this.group(body, "overdue", "Overdue", g((t) => this.dateOf(t) && this.dateOf(t) < t0), { warn: true });
    this.group(body, "today", "Today", g((t) => this.dateOf(t) === t0), { hideDate: true, always: true, addDate: t0 });
    this.group(body, "tomorrow", "Tomorrow", g((t) => this.dateOf(t) === t1), { hideDate: true, addDate: t1 });
    this.group(body, "week", "Next 7 days", g((t) => this.dateOf(t) > t1 && this.dateOf(t) <= t7));
    this.group(body, "later", "Later", g((t) => this.dateOf(t) > t7));
    this.group(body, "nodate", "No date", open.filter((t) => !this.dateOf(t)).sort((a, b) => b.file.stat.mtime - a.file.stat.mtime), { addDate: null });
    if (p.settings.taskShowDone) {
      const done = all.filter((t) => t.done).sort((a, b) => b.file.stat.mtime - a.file.stat.mtime);
      this.group(body, "done", "Completed", done);
    }
  }

  group(body, id, label, list, opts = {}) {
    if (!list.length && !opts.always) return;
    const sec = body.createDiv("ot-tasks-group");
    const h = sec.createDiv("ot-tasks-group-head" + (opts.warn ? " is-warn" : ""));
    const chev = h.createSpan("ot-tasks-chev");
    setIcon(chev, this.collapsed.has(id) ? "chevron-right" : "chevron-down");
    h.createSpan({ text: label });
    h.createSpan({ cls: "ot-tasks-group-n", text: String(list.length) });
    h.onclick = () => { this.collapsed.has(id) ? this.collapsed.delete(id) : this.collapsed.add(id); this.render(); };
    const addable = opts.addDate !== undefined;
    if (addable) {
      const plus = h.createSpan("clickable-icon ot-tasks-group-add");
      setIcon(plus, "plus");
      plus.setAttr("aria-label", "Add a task here");
      plus.onclick = (evt) => { evt.stopPropagation(); this.startAdd(id, opts.addDate); };
      sec.ondblclick = (evt) => {
        if (evt.target.closest(".ot-task-row, .ot-task-pill, .ot-task-add, .ot-tasks-group-head")) return;
        this.startAdd(id, opts.addDate);
      };
    }
    if (this.collapsed.has(id)) return;
    const box = sec.createDiv("ot-tasks-list");
    if (!list.length) box.createDiv({ cls: "ot-tasks-none", text: addable ? "Nothing yet — double-click to add." : "Nothing scheduled." });
    for (const t of list) this.taskRow(box, t, opts);
    if (addable) this.addSlot(id, box, opts.addDate);
  }

  /* ── double-click a place to add a task there, with that place's date ── */
  addState() { return (this._addState ||= {}); }
  startAdd(id, date) {
    const st = this.addState();
    if (this.collapsed?.has(id)) { this.collapsed.delete(id); st.open = id; this.render(); return; }
    const box = this.addBoxes?.get(id);
    if (box) this.inlineAdd(box, date, id);
    else { st.open = id; this.render(); }
  }
  addSlot(id, box, date) {
    (this.addBoxes ||= new Map()).set(id, box);
    const st = this.addState();
    // reopen after adding, and survive redraws (vault changes redraw the list while you type)
    if (st.open === id || st.active === id) { st.open = null; this.inlineAdd(box, date, id); }
  }
  inlineAdd(box, date, id) {
    activeDocument.querySelectorAll(".ot-task-add.is-inline").forEach((e) => e.remove());
    if (this.addState().active && this.addState().active !== id) this.addState().draft = "";
    box.querySelector(".ot-tasks-none")?.addClass("is-hidden");
    const row = box.createDiv("ot-task-add is-inline");
    setIcon(row.createSpan("ot-task-add-icon"), "plus");
    const tnOn = this.plugin.settings.taskSource === "tasknotes" && this.plugin.taskNotes();
    const when = date ? (date === moment().format("YYYY-MM-DD") ? "today" : moment(date, "YYYY-MM-DD").format("ddd, MMM D")) : null;
    const input = row.createEl("input", { type: "text", attr: {
      placeholder: when ? `New task for ${when}${tnOn ? " — “3pm #school”" : ""}` : `New task${tnOn ? " — “Call mom tomorrow #family”" : ""}`,
      enterkeyhint: "done" } });
    const st = this.addState();
    st.active = id;
    if (st.draft) input.value = st.draft;
    input.oninput = () => { st.draft = input.value; };
    window.setTimeout(() => { input.focus(); row.scrollIntoView?.({ block: "nearest" }); }, 0);
    let busy = false;
    const close = () => { st.active = null; st.draft = ""; row.remove(); box.querySelector(".ot-tasks-none")?.removeClass("is-hidden"); };
    input.onkeydown = async (evt) => {
      if (evt.key === "Escape") { evt.preventDefault(); close(); return; }
      if (evt.key !== "Enter" || evt.isComposing || !input.value.trim()) return;
      evt.preventDefault();
      busy = true;
      const text = input.value;
      input.value = ""; st.draft = ""; input.disabled = true;
      try {
        await this.plugin.addTask(text, { date, tag: this.addTag || null, field: this.dateField });
        st.open = id; // keep the input open for the next one
      } catch (e) { new Notice(`Couldn't add the task: ${e.message || e}`); st.draft = text; }
      window.setTimeout(() => this.render(), 400);
    };
    input.onblur = () => window.setTimeout(() => {
      if (!row.isConnected) return; // redrawn: the new copy takes over
      if (busy) return;
      if (!input.value.trim()) close(); else st.active = null; // keep the draft, but don't reopen it by itself
    }, 150);
  }

  check(parent, t) {
    const c = parent.createDiv("ot-task-check" + (t.done ? " is-done" : ""));
    if (t.statusColor && !t.done) c.style.setProperty("--ot-status", t.statusColor);
    if (t.done) setIcon(c, "check");
    c.setAttr("aria-label", t.done ? "Mark as not done" : "Mark as done");
    c.onclick = async (evt) => {
      evt.stopPropagation();
      c.addClass("is-busy");
      try { await this.plugin.toggleTask(t); } catch (e) { new Notice(`Couldn't update the task: ${e.message || e}`); }
      window.setTimeout(() => this.render(), 350);
    };
    return c;
  }

  pill(parent, t) {
    const el = parent.createDiv("ot-task-pill" + (t.done ? " is-done" : ""));
    if (t.prioColor) el.style.setProperty("--ot-prio", t.prioColor);
    this.check(el, t);
    el.createSpan({ cls: "ot-task-pill-text", text: (t.time ? t.time + " " : "") + t.title });
    this.bindTask(el, t);
  }

  taskRow(parent, t, opts = {}) {
    const row = parent.createDiv("ot-task-row" + (t.done ? " is-done" : "") + (opts.compact ? " is-compact" : ""));
    this.check(row, t);
    const main = row.createDiv("ot-task-main");
    main.createDiv({ cls: "ot-task-title", text: t.title });
    const meta = main.createDiv("ot-task-meta");
    const d = this.dateOf(t);
    if (d && !opts.hideDate) {
      const m = moment(d, "YYYY-MM-DD");
      const overdue = !t.done && m.isBefore(moment(), "day");
      const de = meta.createSpan("ot-task-date" + (overdue ? " is-overdue" : ""));
      setIcon(de.createSpan("ot-task-mi"), this.dateKind(t) === "due" ? "calendar" : "calendar-clock");
      de.setAttr("aria-label", this.dateKind(t) === "due" ? "Due" : "Scheduled");
      de.createSpan({ text: m.isSame(moment(), "year") ? m.format("MMM D") : m.format("MMM D, YYYY") });
    }
    if (t.prioColor) {
      const pf = meta.createSpan("ot-task-prio");
      pf.style.setProperty("--ot-prio", t.prioColor);
      setIcon(pf, "flag");
      pf.setAttr("aria-label", `Priority: ${t.prioLabel || ""}`);
    }
    if (t.time) {
      const te = meta.createSpan("ot-task-date");
      setIcon(te.createSpan("ot-task-mi"), "clock");
      te.createSpan({ text: t.time });
    }
    const notes = t.kind === "cb" ? [t.file] : t.notes;
    for (const f of notes.slice(0, 2)) {
      const ne = meta.createSpan("ot-task-note");
      setIcon(ne.createSpan("ot-task-mi"), "file-text");
      ne.createSpan({ text: f.basename });
      ne.onclick = (evt) => { evt.stopPropagation(); this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(f); };
    }
    for (const tag of t.tags.slice(0, opts.compact ? 2 : 4)) meta.createSpan({ cls: "ot-task-tag", text: "#" + tag });
    if (!meta.childElementCount) meta.remove();
    this.bindTask(row, t);
  }

  bindTask(el, t) {
    el.onclick = (evt) => this.plugin.openTask(t, Keymap.isModEvent(evt));
    el.oncontextmenu = (evt) => {
      evt.preventDefault();
      const tn = this.plugin.taskNotes();
      if (t.kind === "tn" && tn?.api?.buildTaskContextMenu) {
        tn.api.buildTaskContextMenu({ taskPath: t.file.path, onUpdate: () => this.render() }).then((cm) => {
          cm.menu.addSeparator();
          cm.menu.addItem((i) => { i.setTitle("Delete task").setIcon("trash-2").onClick(() => this.confirmDelete(t)); i.setWarning?.(true); });
          cm.show(evt);
        }).catch(() => this.basicMenu(evt, t));
      } else this.basicMenu(evt, t);
    };
  }
  basicMenu(evt, t) {
    const m = new Menu();
    m.addItem((i) => i.setTitle(t.done ? "Mark as not done" : "Mark as done").setIcon("check").onClick(async () => { await this.plugin.toggleTask(t); this.render(); }));
    m.addItem((i) => i.setTitle("Open note").setIcon("file-text").onClick(() => this.plugin.openTask(t)));
    m.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus").onClick(() => this.plugin.openTask(t, "tab")));
    m.addSeparator();
    m.addItem((i) => { i.setTitle("Delete task").setIcon("trash-2").onClick(() => this.confirmDelete(t)); i.setWarning?.(true); });
    m.showAtMouseEvent(evt);
  }
  confirmDelete(t) {
    const what = t.kind === "tn" ? `The task note “${t.file.basename}” goes to the trash.` : `The line is removed from “${t.file.basename}”.`;
    new ConfirmModal(this.plugin, `Delete “${t.title}”?`, what, "Delete", async () => {
      try { await this.plugin.deleteTask(t); new Notice(`Deleted “${t.title}”.`); }
      catch (e) { new Notice(`Couldn't delete: ${e.message || e}`); }
      window.setTimeout(() => this.render(), 300);
    }).open();
  }

  scopeMenu(evt) {
    const p = this.plugin;
    const m = new Menu();
    const go = (k) => { this.scope = k; this.leaf.updateHeader?.(); this.app.workspace.requestSaveLayout?.(); this.render(); };
    m.addItem((i) => i.setTitle("All tasks").setIcon("circle-check").setChecked(this.scope === "all").onClick(() => go("all")));
    m.addSeparator();
    for (const t of p.visibleTypes()) m.addItem((i) => i.setTitle(t.label).setIcon(p.iconFor(t.key)).setChecked(this.scope === t.key).onClick(() => go(t.key)));
    m.showAtMouseEvent(evt);
  }

  optionsMenu(evt) {
    const p = this.plugin, pr = this.prefs();
    const m = new Menu();
    m.addItem((i) => i.setTitle("Show completed").setIcon("check-check").setChecked(!!p.settings.taskShowDone).onClick(async () => {
      p.settings.taskShowDone = !p.settings.taskShowDone;
      if (p.settings.taskShowDone) this.collapsed.delete("done");
      await p.saveSettings(false); this.render();
    }));
    m.addSeparator();
    for (const [v, t, ic] of [["due", "By due date", "calendar"], ["scheduled", "By scheduled date", "calendar-clock"], ["any", "Due, else scheduled", "calendar-range"]])
      m.addItem((i) => i.setTitle(t).setIcon(ic).setChecked((pr.dateField || "any") === v).onClick(() => this.setPref({ dateField: v })));
    m.addSeparator();
    m.addItem((i) => i.setTitle("Background image…").setIcon("image").onClick(() =>
      new TaskBgModal(p, (img) => this.setPref({ bg: { ...(pr.bg?.color ? { color: pr.bg.color } : {}), image: img } })).open()));
    m.addItem((i) => {
      i.setTitle("Background color").setIcon("palette");
      const sub = i.setSubmenu?.();
      if (!sub) { i.onClick(() => this.setPref({ bg: { color: COLORS[6].hex } })); return; }
      for (const c of COLORS) sub.addItem((s) => s.setTitle(c.name).setChecked(pr.bg?.color === c.hex && !pr.bg?.image).onClick(() => this.setPref({ bg: { color: c.hex } })));
    });
    if (pr.bg) m.addItem((i) => i.setTitle("Remove background").setIcon("x").onClick(() => this.setPref({ bg: null })));
    if (p.settings.taskSource === "tasknotes" && p.taskNotes()) {
      m.addSeparator();
      m.addItem((i) => i.setTitle("Open TaskNotes calendar").setIcon("calendar-range").onClick(() => this.app.commands.executeCommandById("tasknotes:open-advanced-calendar-view")));
    }
    m.showAtMouseEvent(evt);
  }
}

class HomeEmbed extends MarkdownRenderChild {
  constructor(el, plugin) { super(el); this.plugin = plugin; this.app = plugin.app; this.contentEl = el; }
  onload() {
    this.contentEl.addClass("ot-home-root", "ot-home-embed");
    this.plugin.homeEmbeds.add(this);
    this.render();
    this.registerInterval(window.setInterval(() => { this._greet = null; this.render(); }, 15 * 60 * 1000));
  }
  onunload() { this.plugin.homeEmbeds.delete(this); }
}
for (const k of Object.getOwnPropertyNames(HomeView.prototype)) {
  if (!["constructor", "getViewType", "getDisplayText", "getIcon", "onOpen"].includes(k)) HomeEmbed.prototype[k] = HomeView.prototype[k];
}

class TypefoldView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.selected = null;
    this.query = "";
    this.split = false;
  }
  getViewType() { return VIEW_TYPE; }
  getDisplayText() { return "Typefold"; }
  getIcon() { return "layout-grid"; }
  getState() { return { selected: this.selected }; }
  async setState(state, result) {
    if (state && "selected" in state) this.selected = state.selected;
    this.render();
    return super.setState(state, result);
  }

  async onOpen() {
    this.contentEl.addClass("ot-root");
    this.resizeObs = new ResizeObserver(() => {
      const split = !Platform.isPhone && this.contentEl.clientWidth >= 440;
      if (split !== this.split) { this.split = split; this.render(); }
    });
    this.resizeObs.observe(this.contentEl);
    if (!this.selected && this.plugin.settings.lastSelected) this.selected = this.plugin.settings.lastSelected;
    this.render();
  }
  async onClose() { this.resizeObs?.disconnect(); this._pvIO?.disconnect(); }

  select(key, opts = {}) {
    if (key === "smart:tasks" && this.plugin.calendarMerged()) key = "smart:calendar";
    this.listLimit = 0;
    this.plugin.settings.lastSelected = key;
    this.plugin.saveData(this.plugin.settings);
    if ((key === "smart:calendar" || key === "smart:tasks") && this.plugin.settings.listClosed) { this.selected = key; this.setListClosed(false); }
    this.selected = key;
    this.query = "";
    this.app.workspace.requestSaveLayout();
    this.render();
    const fk = this.plugin.parseFolderKey(key);
    if (fk) {
      const note = this.plugin.folderNoteOf(fk.path);
      if (note && !opts.noOpen) this.app.workspace.getLeaf(false).openFile(note);
    } else if (key && !key.includes(":") && !opts.noOpen) {
      if (this.plugin.typePagesAllowed(key)) this.plugin.openTypeBase(key);
      else if (this.plugin.settings.listClosed) this.setListClosed(false); // no page: show its notes in the list instead
    }
  }

  render() {
    const el = this.contentEl;
    this._pvIO?.disconnect(); this._pvIO = null; // rows from the last draw are gone
    const navScroll = el.querySelector(".ot-nav-pane .ot-scroll")?.scrollTop || 0;
    const listScroll = el.querySelector(".ot-list-pane .ot-list")?.scrollTop || 0;
    el.empty();
    el.toggleClass("ot-split", this.split);
    const listClosed = !!this.plugin.settings.listClosed;
    el.toggleClass("ot-list-closed", listClosed);
    if (this.split && !listClosed) {
      const nav = el.createDiv("ot-pane ot-nav-pane");
      nav.style.width = this.plugin.settings.navWidth + "px";
      this.renderNav(nav);
      this.renderDivider(el.createDiv("ot-divider"), nav);
      this.renderList(el.createDiv("ot-pane ot-list-pane"));
    } else if (listClosed) {
      this.renderNav(el.createDiv("ot-pane ot-nav-pane"));
    } else if (this.selected) {
      this.renderList(el.createDiv("ot-pane ot-list-pane"), true);
    } else {
      this.renderNav(el.createDiv("ot-pane ot-nav-pane"));
    }
    const ns = el.querySelector(".ot-nav-pane .ot-scroll"); if (ns) ns.scrollTop = navScroll;
    const ls = el.querySelector(".ot-list-pane .ot-list"); if (ls) ls.scrollTop = listScroll;
  }

  async setListClosed(v) {
    const st = this.plugin.settings;
    try {
      const ls = this.app.workspace.leftSplit;
      if (ls && this.contentEl.closest(".mod-left-split")) {
        if (v) { st.sidebarWide = ls.size; ls.setSize(st.navWidth + 16); }
        else ls.setSize(st.sidebarWide && st.sidebarWide < 900 ? st.sidebarWide : st.navWidth + 300);
      }
    } catch (e) {}
    this.plugin.settings.listClosed = v;
    await this.plugin.saveSettings(false);
    this.render();
  }

  renderDivider(div, nav) {
    div.onmousedown = (e) => {
      e.preventDefault();
      const startX = e.clientX, startW = nav.offsetWidth;
      const move = (ev) => {
        const w = Math.max(160, Math.min(400, startW + ev.clientX - startX));
        nav.style.width = w + "px";
        this.plugin.settings.navWidth = w;
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        this.plugin.saveSettings(false);
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
  }

  /* ── left pane ── */
  renderNav(pane) {
    const p = this.plugin;
    const top = pane.createDiv("ot-nav-top");
    const newBtn = top.createDiv("ot-new-btn");
    setIcon(newBtn.createSpan("ot-new-icon"), "plus");
    newBtn.createSpan({ text: "New" });
    newBtn.onclick = () => p.newObjectFlow();
    const search = top.createDiv("ot-search-btn");
    setIcon(search.createSpan("ot-search-icon"), "search");
    search.createSpan({ cls: "ot-search-label", text: "Search" });
    if (this.plugin.settings.newTabSearch) search.createSpan({ cls: "ot-kbd", text: "⌘T" });
    // Typefold's own search panel: the core Quick switcher may be turned off
    search.onclick = () => new QuickOpenModal(this.plugin, null).open();
    if (this.plugin.settings.listClosed) {
      const open = top.createDiv("clickable-icon ot-list-toggle");
      setIcon(open, "panel-right-open");
      open.setAttr("aria-label", "Show note list");
      open.onclick = () => this.setListClosed(false);
    }

    const scroll = pane.createDiv("ot-scroll");
    const row = (parent, key, label, opts = {}) => {
      const r = parent.createDiv("ot-nav-row");
      if (key === this.selected) r.addClass("is-selected");
      const tile = paintIcon(r.createSpan(), opts.icon || p.iconFor(key), opts.color || p.colorFor(key));
      if (key && !key.includes(":") && !opts.icon && !p.settings.types[key]?.icon) {
        const folders = p.typeFolders(key);
        const iz = folders.length === 1 && p.iconizeInfo(folders[0]);
        if (iz) p.drawIconize(tile, { name: iz.name, color: iz.color || p.colorFor(key) });
      }
      r.createSpan({ cls: "ot-nav-label", text: label });
      if (p.settings.showCounts && opts.count != null) r.createSpan({ cls: "ot-count", text: String(opts.count) });
      r.onclick = opts.onClick || (() => this.select(key));
      r.oncontextmenu = (evt) => (opts.menu ? opts.menu(evt) : this.typeMenu(evt, key));
      return r;
    };
    const section = (title) => {
      const s = scroll.createDiv("ot-section");
      s.createDiv({ cls: "ot-section-title", text: title });
      return s;
    };

    if (p.settings.showSmart) {
      const s = scroll.createDiv("ot-section ot-smart");
      const shown = p.settings.smartItems || SMART.map((x) => x.key);
      for (const sm of SMART.filter((x) => shown.includes(x.key) && !(x.key === "smart:tasks" && p.calendarMerged()))) {
        const r = row(s, sm.key, p.labelFor(sm.key), { icon: sm.icon, color: "#8E8E93", menu: (e) => {
          const m = new Menu();
          m.addItem((i) => i.setTitle(`Hide “${sm.label}”`).setIcon("eye-off").onClick(async () => {
            p.settings.smartItems = shown.filter((k) => k !== sm.key); await p.saveSettings(false); this.render();
          }));
          m.showAtMouseEvent(e);
        } });
        if (sm.key === "smart:home") r.onclick = () => p.openHome();
      }
    }

    const pins = p.settings.pinned.filter((x) => x.kind === "type" ? p.index.has(x.id) || p.special(x.id) : this.app.vault.getAbstractFileByPath(x.id));
    if (pins.length) {
      const s = section("Pinned");
      for (const pin of pins) {
        if (pin.kind === "type") row(s, pin.id, p.labelFor(pin.id));
        else {
          const f = this.app.vault.getAbstractFileByPath(pin.id);
          const tk = p.typeOfFile(f);
          const r = row(s, null, f.basename, {
            icon: tk ? p.iconFor(tk) : "file-text", color: tk ? p.colorFor(tk) : "#8E8E93",
            onClick: (evt) => this.app.workspace.getLeaf(Keymap.isModEvent(evt)).openFile(f),
            menu: (evt) => this.noteMenu(evt, f),
          });
          if (this.app.workspace.getActiveFile() === f) r.addClass("is-active-note");
        }
      }
    }

    if (p.settings.showFavorites) this.renderFavorites(scroll);
    if (p.settings.showRecents) this.renderRecents(scroll);

    const ts = section("Object Types");
    const titleEl = ts.querySelector(".ot-section-title");
    const anyOpen = Object.keys(p.settings.expanded || {}).length > 0;
    const toggleAll = titleEl.createSpan("clickable-icon ot-section-add ot-toggle-all");
    setIcon(toggleAll, anyOpen ? "chevrons-down-up" : "chevrons-up-down");
    toggleAll.setAttr("aria-label", anyOpen ? "Collapse all folders" : "Expand all folders");
    toggleAll.setAttr("role", "button");
    toggleAll.onclick = async () => {
      if (anyOpen) p.settings.expanded = {};
      else {
        const ex = (p.settings.expanded = {});
        for (const t of p.visibleTypes()) {
          ex[t.key] = true;
          const walk = (folder) => {
            for (const [path] of p.subfolders(t.key, folder)) { ex[p.folderKey(t.key, path)] = true; walk(path); }
          };
          walk(p.typeRoot(t.key));
        }
      }
      await p.saveSettings(false);
      this.render();
    };
    const addType = titleEl.createSpan("clickable-icon ot-section-add");
    setIcon(addType, "plus");
    addType.setAttr("aria-label", "New object type");
    addType.setAttr("role", "button");
    addType.onclick = () => new NewTypeModal(p).open();
    const types = this.foldTitle(ts, "types") ? [] : p.visibleTypes();
    if (!types.length && !p.settings.closedSections?.types) ts.createDiv({ cls: "ot-empty", text: `No notes with a "${p.prop}" property yet.` });
    for (const t of types) {
      const r = this.makeSortable(row(ts, t.key, t.label, { count: t.count }), t.key, types) || null;
      this.renderFolderTree(ts, t.key, p.typeRoot(t.key), 1, ts.lastElementChild);
    }

    this.renderArchive(scroll);

    if (p.settings.showFiles) {
      const fs = section("Files");
      const filesClosed = this.foldTitle(fs, "files");
      for (const t of filesClosed ? [] : p.visibleTypes({ files: true })) {
        const r = row(fs, t.key, t.label, { count: t.count });
        this.renderFolderTree(fs, t.key, p.typeRoot(t.key), 1, r);
      }
      for (const fc of filesClosed ? [] : FILE_COLLECTIONS) {
        const r = row(fs, fc.key, fc.label, { count: p.filesFor(fc.key).length });
        if (fc.key === "file:tags") this.renderTagTree(fs, null, 1, r);
      }
    }

    const foot = pane.createDiv("ot-nav-foot");
    const vault = foot.createDiv("ot-vault");
    setIcon(vault.createSpan("ot-foot-icon"), "lightbulb");
    vault.createSpan({ cls: "ot-vault-name", text: this.app.vault.getName() });
    setIcon(vault.createSpan("ot-foot-chevron"), "chevrons-up-down");
    vault.onclick = () => { try { this.app.openVaultChooser(); } catch (e) {} };
    foot.createDiv("ot-spacer");
    const btn = (icon, label, fn) => {
      const b = foot.createDiv("clickable-icon ot-foot-btn");
      setIcon(b, icon);
      b.setAttr("aria-label", label);
      b.onclick = fn;
    };
    btn("settings", "Settings", () => this.app.commands.executeCommandById("app:open-settings"));
    btn(document.body.hasClass("theme-dark") ? "sun" : "moon", "Toggle light/dark", () => {
      const dark = document.body.hasClass("theme-dark");
      try { this.app.changeTheme(dark ? "moonstone" : "obsidian"); } catch (e) {
        document.body.toggleClass("theme-dark", !dark); document.body.toggleClass("theme-light", dark);
      }
      this.render();
    });
    btn("command", "Command palette", () => this.app.commands.executeCommandById("command-palette:open"));
  }

  /** make an existing section title fold its section; returns true when it's folded */
  foldTitle(sec, id) {
    const p = this.plugin;
    const t = sec.querySelector(".ot-section-title");
    const closed = !!p.settings.closedSections?.[id];
    if (!t) return closed;
    t.addClass("ot-fold-title");
    const chev = createSpan("ot-fold-chev");
    setIcon(chev, "chevron-right");
    chev.toggleClass("is-open", !closed);
    t.insertBefore(chev, t.childNodes[1] || null);
    t.onclick = async (e) => {
      if (e.target.closest(".ot-section-add")) return; // its own buttons
      p.settings.closedSections ||= {};
      p.settings.closedSections[id] = !closed;
      await p.saveSettings(false);
      this.render();
    };
    return closed;
  }

  /** a small section title like “Object Types” that folds its section open and closed */
  foldSection(scroll, id, title) {
    const p = this.plugin;
    const closed = !!p.settings.closedSections?.[id];
    const sec = scroll.createDiv("ot-section ot-fold-section");
    const t = sec.createDiv("ot-section-title ot-fold-title");
    t.createSpan({ text: title });
    const chev = t.createSpan("ot-fold-chev");
    setIcon(chev, "chevron-right");
    chev.toggleClass("is-open", !closed);
    t.setAttr("role", "button");
    t.setAttr("aria-label", closed ? `Show ${title}` : `Hide ${title}`);
    t.onclick = async () => {
      p.settings.closedSections ||= {};
      p.settings.closedSections[id] = !closed;
      await p.saveSettings(false);
      this.render();
    };
    return closed ? null : sec;
  }

  /** "Recents": files you opened lately, as compact rows */
  renderRecents(scroll) {
    const p = this.plugin;
    const files = p.filesFor("smart:recent").slice(0, Math.max(1, p.settings.recentsCount || 7));
    if (!files.length) return;
    const sec = this.foldSection(scroll, "recents", "Recents");
    if (!sec) return;
    const active = this.app.workspace.getActiveFile()?.path;
    for (const f of files) {
      const r = sec.createDiv("ot-nav-row ot-folder-row ot-fav-row ot-file-row");
      r.style.paddingLeft = "8px";
      const ic = r.createSpan("ot-folder-icon");
      const iz = p.iconizeInfo(f.path);
      const own = p.settings.noteIcons?.[f.path];
      if (!(iz && p.drawIconize(ic, iz))) {
        if (own) paintIcon(ic, own.icon, own.color || NO_COLOR);
        else setIcon(ic, f.extension === "md" ? "file-text" : f.extension === "canvas" ? "layout-dashboard" : f.extension === "base" ? "table" : f.extension === "pdf" ? "file-type" : "file");
      }
      r.createSpan({ cls: "ot-nav-label", text: f.basename });
      if (f.path === active) r.addClass("is-active-note");
      this.bindFile(r, f);
      r.oncontextmenu = (evt) => this.noteMenu(evt, f, (m) => m.addItem((i) => {
        i.setTitle("Remove from Recents").setIcon("x").onClick(async () => {
          p.settings.recentFiles = (p.settings.recentFiles || []).filter((x) => x !== f.path);
          await p.saveSettings(false); this.render();
        });
        i.setSection?.("action");
      }));
    }
  }

  /** "Favorites": the core Bookmarks list, drawn like subfolder rows */
  renderFavorites(s) {
    const p = this.plugin;
    const bm = this.app.internalPlugins?.getPluginById?.("bookmarks");
    const items = bm?.enabled ? bm.instance?.items || [] : [];
    if (!items.length) return;
    s = this.foldSection(s, "favorites", "Favorites");
    if (!s) return;
    const active = this.app.workspace.getActiveFile()?.path;
    const title = (it) => { try { return bm.instance.getItemTitle(it); } catch (e) { return it.title || it.path || it.query || "Bookmark"; } };
    // right-click: remove the bookmark (and, for files, open it in a new tab)
    const menuFor = (r, it, file) => {
      r.oncontextmenu = (evt) => {
        evt.preventDefault();
        const m = new Menu();
        if (file) m.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus").onClick(() => this.app.workspace.getLeaf("tab").openFile(file)));
        m.addItem((i) => i.setTitle(it.type === "group" ? "Remove group from Favorites" : "Remove from Favorites").setIcon("bookmark-minus")
          .onClick(() => bm.instance.removeItem(it)));
        m.showAtMouseEvent(evt);
      };
    };
    const draw = (parent, list, depth) => {
      for (const it of list) {
        const r = parent.createDiv("ot-nav-row ot-folder-row ot-fav-row");
        menuFor(r, it, null);
        r.style.paddingLeft = `${8 + depth * 16}px`;
        const ic = r.createSpan("ot-folder-icon");
        const label = () => r.createSpan({ cls: "ot-nav-label", text: it.title || title(it) });
        if (it.type === "group") {
          setIcon(ic, "folder-heart");
          label();
          r.onclick = null;
          draw(parent, it.items || [], depth + 1);
          continue;
        }
        const f = it.path ? this.app.vault.getAbstractFileByPath(it.path) : null;
        if (it.type === "folder" && f instanceof TFolder) {
          const key = p.folderSelectKey(f.path);
          const custom = key && p.settings.types[key];
          const iz = p.iconizeInfo(f.path);
          if (custom?.icon || custom?.color) paintIcon(ic, custom.icon || "folder", custom.color || NO_COLOR);
          else if (!(iz && p.drawIconize(ic, iz))) setIcon(ic, "folder");
          label();
          if (key && key === this.selected) r.addClass("is-selected");
          r.onclick = (evt) => {
            if (key) return this.select(key);
            const fn = p.folderNoteOf(f.path);
            if (fn) p.openFromPanel(fn, evt); else bm.instance.openBookmark(it, Keymap.isModEvent(evt));
          };
          continue;
        }
        if (it.type === "file" && f && !(f instanceof TFolder)) {
          const iz = p.iconizeInfo(f.path);
          const own = p.settings.noteIcons?.[f.path];
          if (!(iz && p.drawIconize(ic, iz))) {
            if (own) paintIcon(ic, own.icon, own.color || NO_COLOR);
            else setIcon(ic, f.extension === "md" ? "file-text" : f.extension === "canvas" ? "layout-dashboard" : f.extension === "base" ? "table" : f.extension === "pdf" ? "file-type" : "file");
          }
          label();
          this.bindFile(r, f);
          r.addClass("ot-file-row");
          r.oncontextmenu = (evt) => this.noteMenu(evt, f, (m) => m.addItem((i) => {
            i.setTitle("Remove from Favorites").setIcon("bookmark-minus").onClick(() => bm.instance.removeItem(it));
            i.setSection?.("action");
          }));
          if (f.path === active) r.addClass("is-active-note");
          if (it.subpath) r.onclick = (evt) => bm.instance.openBookmark(it, Keymap.isModEvent(evt));
          continue;
        }
        // search, url, graph, or a file that no longer exists
        setIcon(ic, it.type === "search" ? "search" : it.type === "url" ? "link" : it.type === "graph" ? "git-fork" : "bookmark");
        label();
        if (it.path && !f) r.addClass("is-missing");
        r.onclick = (evt) => bm.instance.openBookmark(it, Keymap.isModEvent(evt));
      }
    };
    draw(s, items, 1);
  }

  renderArchive(scroll) {
    const p = this.plugin;
    const types = Object.entries(p.settings.types).filter(([k, c]) => c.registered && c.hidden && !k.includes(":"));
    const paths = p.settings.archived || [];
    if (!types.length && !paths.length) return;
    // placed after Files, at the very end of the list
    const sec = createDiv("ot-section ot-archive-section");
    queueMicrotask(() => scroll.appendChild(sec));
    const head = sec.createDiv("ot-nav-row");
    if (this.selected === "smart:archive") head.addClass("is-selected");
    paintIcon(head.createSpan(), "archive", NO_COLOR);
    head.createSpan({ cls: "ot-nav-label", text: "Archive" });
    head.createSpan({ cls: "ot-count ot-tag-count", text: String(types.length + paths.length) });
    head.onclick = () => this.select("smart:archive");
    const open = !!p.settings.expanded["smart:archive"];
    const chev = head.createSpan("ot-chevron");
    setIcon(chev, "chevron-right");
    chev.toggleClass("is-open", open);
    chev.onclick = async (e) => {
      e.stopPropagation();
      if (open) delete p.settings.expanded["smart:archive"]; else p.settings.expanded["smart:archive"] = true;
      await p.saveSettings(false); this.render();
    };
    if (!open) return;
    const item = (icon, color, label, restore) => {
      const r = sec.createDiv("ot-nav-row ot-folder-row ot-archived-row");
      r.style.paddingLeft = "24px";
      paintIcon(r.createSpan("ot-folder-icon"), icon, color);
      r.createSpan({ cls: "ot-nav-label", text: label });
      const b = r.createSpan("clickable-icon ot-row-edit ot-row-restore");
      setIcon(b, "archive-restore");
      b.setAttr("aria-label", "Unarchive");
      b.onclick = (e) => { e.stopPropagation(); restore(); };
      r.oncontextmenu = (e) => { const m = new Menu(); m.addItem((i) => i.setTitle("Unarchive").setIcon("archive-restore").onClick(restore)); m.showAtMouseEvent(e); };
    };
    for (const [k] of types) item(p.iconFor(k), p.colorFor(k), p.labelFor(k), async () => { delete p.conf(k).hidden; await p.saveSettings(); });
    for (const path of paths) {
      const f = this.app.vault.getAbstractFileByPath(path);
      item(f instanceof TFolder ? "folder" : "file-text", NO_COLOR, path.split("/").pop().replace(/\.md$/, ""), () => p.setArchived(path, false));
    }
  }

  renderTagTree(parent, tag, depth, ownerRow) {
    const p = this.plugin;
    const kids = p.childTags(tag);
    if (!kids.length) return;
    const nodeKey = tag ? "tag:" + tag : "file:tags";
    const open = !!p.settings.expanded[nodeKey];
    const chev = ownerRow.createSpan("ot-chevron");
    setIcon(chev, "chevron-right");
    chev.toggleClass("is-open", open);
    chev.onclick = async (e) => {
      e.stopPropagation();
      if (open) delete p.settings.expanded[nodeKey]; else p.settings.expanded[nodeKey] = true;
      await p.saveSettings(false); this.render();
    };
    if (!open) return;
    for (const [t, n] of kids) {
      const key = "tag:" + t;
      const r = parent.createDiv("ot-nav-row ot-folder-row ot-tag-row");
      r.style.paddingLeft = `${8 + depth * 16}px`;
      if (key === this.selected) r.addClass("is-selected");
      setIcon(r.createSpan("ot-folder-icon"), "hash");
      r.createSpan({ cls: "ot-nav-label", text: t.split("/").pop() });
      r.createSpan({ cls: "ot-count ot-tag-count", text: String(n) });
      r.onclick = () => this.select(key);
      this.renderTagTree(parent, t, depth + 1, r);
    }
  }

  /** files that sit directly in a folder (shown in the tree under their folder) */
  treeFiles(folder) {
    const p = this.plugin;
    const tf = folder && this.app.vault.getAbstractFileByPath(folder);
    if (!(tf instanceof TFolder)) return [];
    const show = ["md", "canvas", "base", ...DOC_EXT, ...IMG_EXT];
    const bases = normalizePath(p.settings.basesFolder || "Typefold") + "/";
    return tf.children
      .filter((c) => c.extension && show.includes(c.extension.toLowerCase()) && !p.isFolderNote(c) && !p.isArchived(c.path) && !c.path.startsWith(bases))
      .sort((a, b) => a.basename.localeCompare(b.basename, undefined, { numeric: true }));
  }

  renderFileRows(parent, files, depth, typeKey) {
    const p = this.plugin;
    const active = this.app.workspace.getActiveFile()?.path;
    for (const f of files) {
      const r = parent.createDiv("ot-nav-row ot-file-row");
      r.style.paddingLeft = `${8 + depth * 16}px`;
      r.dataset.path = f.path;
      if (f.path === active) r.addClass("is-active-note");
      const ic = r.createSpan("ot-file-icon");
      const iz = p.iconizeInfo(f.path);
      if (iz && p.drawIconize(ic, iz)) { r.createSpan({ cls: "ot-nav-label", text: f.extension === "md" ? f.basename : f.name }); this.bindFile(r, f); continue; }
      const ownIc = p.settings.noteIcons?.[f.path];
      if (ownIc) { paintIcon(ic, ownIc.icon, ownIc.color || NO_COLOR); r.createSpan({ cls: "ot-nav-label", text: f.basename }); this.bindFile(r, f); continue; }
      const icon = f.extension === "md" ? "file-text" : f.extension === "canvas" ? "layout-dashboard" : f.extension === "base" ? "table" : f.extension === "pdf" ? "file-type" : IMG_EXT.includes(f.extension.toLowerCase()) ? "image" : "file";
      setIcon(ic, icon);
      r.createSpan({ cls: "ot-nav-label", text: f.extension === "md" ? f.basename : f.name });
      this.bindFile(r, f);
    }
  }

  renderFolderTree(parent, typeKey, folder, depth, ownerRow) {
    const p = this.plugin;
    const kids = p.subfolders(typeKey, folder);
    const files = folder ? this.treeFiles(folder) : [];
    if (!kids.length && !files.length) return;
    const nodeKey = depth === 1 ? typeKey : p.folderKey(typeKey, folder);
    const open = !!p.settings.expanded[nodeKey];
    const chev = ownerRow.createSpan("ot-chevron");
    setIcon(chev, "chevron-right");
    chev.toggleClass("is-open", open);
    ownerRow.addClass("has-children");
    chev.onclick = async (e) => {
      e.stopPropagation();
      if (open) delete p.settings.expanded[nodeKey];
      else { p.collapseOthers(typeKey, depth === 1 ? null : folder); p.settings.expanded[nodeKey] = true; }
      await p.saveSettings(false);
      this.render();
    };
    if (!open) return;
    for (const [path, count] of kids) {
      const key = p.folderKey(typeKey, path);
      const r = parent.createDiv("ot-nav-row ot-folder-row");
      r.style.paddingLeft = `${8 + depth * 16}px`;
      if (key === this.selected) r.addClass("is-selected");
      const custom = p.settings.types[key];
      const ic = r.createSpan("ot-folder-icon");
      const iz = !custom?.icon && p.iconizeInfo(path);
      if (custom?.icon || custom?.color) paintIcon(ic, custom.icon || "folder", custom.color || p.colorFor(typeKey));
      else if (!(iz && p.drawIconize(ic, iz))) setIcon(ic, p.settings.expanded[key] ? "folder-open" : "folder");
      r.createSpan({ cls: "ot-nav-label", text: path.split("/").pop() });
      if (p.settings.showCounts) r.createSpan({ cls: "ot-count", text: String(count) });
      const pal = r.createSpan("clickable-icon ot-row-edit");
      setIcon(pal, "palette");
      pal.setAttr("aria-label", "Change icon & color");
      pal.onclick = (e) => { e.stopPropagation(); new TypeConfigModal(p, key, () => this.render()).open(); };
      r.onclick = () => this.select(key);
      r.oncontextmenu = (evt) => {
        const m = new Menu();
        m.addItem((i) => i.setTitle("Change icon & color…").setIcon("palette").onClick(() =>
          new TypeConfigModal(p, key, () => this.render()).open()));
        m.addItem((i) => i.setTitle("Archive folder").setIcon("archive").onClick(() => p.setArchived(path, true)));
        m.addItem((i) => i.setTitle("Make this folder its own type…").setIcon("shapes").onClick(() =>
          new NewTypeModal(p, { folder: path, label: path.split("/").pop() }).open()));
        const fnote = p.folderNoteOf(path);
        if (fnote) m.addItem((i) => i.setTitle("Open folder note").setIcon("file-text").onClick(() => this.app.workspace.getLeaf(false).openFile(fnote)));
        const tf = this.app.vault.getAbstractFileByPath(path);
        if (tf instanceof TFolder) {
          m.addSeparator();
          m.addItem((i) => i.setTitle("Rename…").setIcon("pencil").onClick(() => this.app.fileManager.promptForFileRename(tf)));
          m.addItem((i) => { i.setTitle("Delete").setIcon("trash-2").onClick(() => this.app.fileManager.promptForFolderDeletion(tf)); i.setWarning?.(true); });
          this.app.workspace.trigger("file-menu", m, tf, "file-explorer-context-menu", this.leaf);
        }
        m.showAtMouseEvent(evt);
      };
      this.renderFolderTree(parent, typeKey, path, depth + 1, r);
    }
    this.renderFileRows(parent, files, depth, typeKey);
  }

  makeSortable(r, key, types) {
    const p = this.plugin;
    r.draggable = !Platform.isMobile; // touch: reorder with long-press → Move up / Move down
    r.dataset.key = key;
    r.ondragstart = (e) => {
      e.dataTransfer.setData("text/ot-type", key);
      e.dataTransfer.effectAllowed = "move";
      r.addClass("is-dragging");
    };
    r.ondragend = () => r.removeClass("is-dragging");
    r.ondragover = (e) => {
      if (!e.dataTransfer.types.includes("text/ot-type")) return;
      e.preventDefault();
      const after = e.offsetY > r.offsetHeight / 2;
      r.toggleClass("ot-drop-before", !after);
      r.toggleClass("ot-drop-after", after);
    };
    r.ondragleave = () => r.removeClass("ot-drop-before", "ot-drop-after");
    r.ondrop = async (e) => {
      const from = e.dataTransfer.getData("text/ot-type");
      const after = r.hasClass("ot-drop-after");
      r.removeClass("ot-drop-before", "ot-drop-after");
      if (!from || from === key) return;
      e.preventDefault();
      const order = types.map((t) => t.key).filter((k) => k !== from);
      order.splice(order.indexOf(key) + (after ? 1 : 0), 0, from);
      await this.saveOrder(order);
    };
    return r;
  }

  async saveOrder(order) {
    const p = this.plugin;
    const rest = (p.settings.typeOrder || []).filter((k) => !order.includes(k));
    p.settings.typeOrder = [...order, ...rest];
    p.settings.sortTypes = "manual";
    await p.saveSettings(false);
    this.render();
  }

  async moveType(key, dir) {
    const order = this.plugin.visibleTypes().map((t) => t.key);
    const i = order.indexOf(key), j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    await this.saveOrder(order);
  }

  typeMenu(evt, key) {
    const p = this.plugin;
    const isType = !key.includes(":");
    const menu = new Menu();
    if (isType) menu.addItem((i) => i.setTitle(`New ${p.labelFor(key)}`).setIcon("plus").onClick(() => p.createObject(key)));
    if (isType) {
      menu.addItem((i) => i.setTitle("Move up").setIcon("arrow-up").onClick(() => this.moveType(key, -1)));
      menu.addItem((i) => i.setTitle("Move down").setIcon("arrow-down").onClick(() => this.moveType(key, 1)));
    }
    menu.addItem((i) => i.setTitle(p.isPinned("type", key) ? "Unpin" : "Pin").setIcon("pin").onClick(() => p.togglePin("type", key)));
    menu.addItem((i) => i.setTitle("Change icon & color…").setIcon("palette").onClick(() => new TypeConfigModal(p, key).open()));
    if (isType) menu.addItem((i) => i.setTitle("Show tasks").setIcon("circle-check").onClick(() => p.openTasks(key)));
    if (isType && p.settings.openBaseOnClick !== false) menu.addItem((i) => {
      const off = !!p.settings.types[key]?.noPage;
      i.setTitle(off ? "Use a type page" : "Don't use a type page").setIcon(off ? "file-plus" : "file-x").onClick(async () => {
        if (off) delete p.conf(key).noPage; else p.conf(key).noPage = true;
        await p.saveSettings(false);
        new Notice(off ? `Clicking “${p.labelFor(key)}” opens its page again.` : `“${p.labelFor(key)}” won't create or open a page; its notes show in the sidebar list.`);
      });
    });
    if (isType) {
      menu.addSeparator();
      menu.addItem((i) => i.setTitle("Archive").setIcon("archive").onClick(async () => {
        p.conf(key).hidden = true;
        if (this.selected === key) this.selected = null;
        await p.saveSettings();
      }));
      menu.addItem((i) => i.setTitle("Delete type…").setIcon("trash-2").setWarning?.(true).onClick(() => new DeleteTypeModal(p, key).open()));
    }
    menu.showAtMouseEvent(evt);
  }

  noteMenu(evt, file, extra) {
    const p = this.plugin;
    const app = this.app;
    const m = new Menu();
    const add = (section, title, icon, fn, warn) => m.addItem((i) => {
      i.setTitle(title).setIcon(icon).onClick(fn);
      i.setSection?.(section);
      if (warn) i.setWarning?.(true);
    });
    // with the core File explorer's own items (new window, move, default app, Finder, copy path) added by "file-menu" below
    add("open", "Open in new tab", "file-plus", () => app.workspace.getLeaf("tab").openFile(file));
    add("open", "Open to the right", "separator-vertical", () => app.workspace.getLeaf("split").openFile(file));
    add("action", p.isPinned("note", file.path) ? "Unpin" : "Pin", "pin", () => p.togglePin("note", file.path));
    const arch = p.isArchived(file.path);
    add("action", arch ? "Unarchive" : "Archive", arch ? "archive-restore" : "archive", () => p.setArchived(file.path, !arch));
    add("action", "Make a copy", "files", async () => {
      const dir = file.parent && !file.parent.isRoot() ? file.parent.path + "/" : "";
      const path = app.vault.getAvailablePath ? app.vault.getAvailablePath(dir + file.basename, file.extension) : dir + file.basename + " 1." + file.extension;
      const copy = await app.vault.copy(file, path);
      if (file.extension === "md") app.workspace.getLeaf(false).openFile(copy);
    });
    add("action", "Rename…", "pencil", () => app.fileManager.promptForFileRename(file));
    extra?.(m);
    add("danger", "Delete", "trash-2", () => app.fileManager.promptForDeletion(file), true);
    app.workspace.trigger("file-menu", m, file, "file-explorer-context-menu", this.leaf);
    m.showAtMouseEvent(evt);
  }

  /* ── right pane ── */
  /* ── list preferences (per type) ── */
  prefKey(key) { const fk = this.plugin.parseFolderKey(key); return fk ? fk.type : key; }
  listPrefs(key) {
    const all = (this.plugin.settings.listPrefs ||= {});
    const d = { sort: "edited", dir: "desc", group: "date", preview: 2, tags: false, props: [] };
    return Object.assign(d, all[this.prefKey(key)] || {});
  }
  async setListPref(key, patch) {
    const all = (this.plugin.settings.listPrefs ||= {});
    all[this.prefKey(key)] = Object.assign(this.listPrefs(key), patch);
    await this.plugin.saveSettings(false);
    this.render();
  }

  createdTime(f) {
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter || {};
    for (const k of ["created", "date_created", "date created", "created_at", "date"]) {
      const v = fm[k];
      if (v && typeof v !== "object") { const m = moment(String(v)); if (m.isValid()) return m.valueOf(); }
    }
    return f.stat.ctime;
  }
  sortTime(f, sort) { return sort === "created" ? this.createdTime(f) : f.stat.mtime; }

  sortedFiles(key) {
    const pr = this.listPrefs(key);
    const files = [...this.plugin.filesFor(key)];
    const sign = pr.dir === "asc" ? 1 : -1;
    if (pr.sort === "title") files.sort((a, b) => sign * -a.basename.localeCompare(b.basename, undefined, { numeric: true }));
    else files.sort((a, b) => sign * (this.sortTime(a, pr.sort) - this.sortTime(b, pr.sort)));
    return files;
  }

  /** frontmatter properties with short scalar values that exist in these files (group-by candidates) */
  groupableProps(files) {
    const cnt = new Map();
    const skip = new Set([this.plugin.prop, "description", "summary", "url", "doi", "aliases", "cssclasses", "title", "authors", ...THUMB_KEYS]);
    for (const f of files.slice(0, 400)) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter || {};
      for (const [k, v] of Object.entries(fm)) {
        if (skip.has(k) || k === "position") continue;
        const ok = (typeof v === "string" && v.length < 40) || typeof v === "number" || typeof v === "boolean"
          || (Array.isArray(v) && v.length && v.every((x) => typeof x === "string" && x.length < 40));
        if (ok) cnt.set(k, (cnt.get(k) || 0) + 1);
      }
    }
    return [...cnt.entries()].filter(([, c]) => c >= Math.max(2, files.length * 0.2))
      .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k]) => k);
  }

  groupOf(f, pr, key) {
    if (pr.group === "date") return { label: groupLabel(this.sortTime(f, pr.sort === "created" ? "created" : "edited")), order: -this.sortTime(f, pr.sort === "created" ? "created" : "edited") };
    if (pr.group === "folder") {
      const fk = this.plugin.parseFolderKey(key);
      const base = fk ? fk.path : this.plugin.typeRoot(this.prefKey(key));
      const fp = f.parent?.path || "";
      const rel = base && fp.startsWith(base + "/") ? fp.slice(base.length + 1) : (fp === base ? "" : fp);
      return { label: rel || "(this folder)", order: rel ? rel : "\uffff" };
    }
    if (pr.group.startsWith("prop:")) {
      const k = pr.group.slice(5);
      let v = this.app.metadataCache.getFileCache(f)?.frontmatter?.[k];
      if (Array.isArray(v)) v = v[0];
      v = v == null || v === "" ? null : cleanLink(v);
      return { label: v ?? "No " + k, order: v ?? "\uffff" };
    }
    return null;
  }

  /** Tasks in the sidebar: editable views (Today / Week / Month / List) with their own name, icon and filters */
  taskPanelViews() {
    const s = this.plugin.settings;
    if (!Array.isArray(s.taskPanelViews) || !s.taskPanelViews.length) s.taskPanelViews = DEFAULT_TASK_VIEWS.map((v) => ({ ...v, filter: { ...v.filter } }));
    return s.taskPanelViews;
  }
  currentTaskView() {
    const views = this.taskPanelViews();
    return views.find((v) => v.id === this.plugin.settings.taskPanelView) || views[0];
  }
  renderTaskPane(pane, withBack) {
    const p = this.plugin;
    const views = this.taskPanelViews();
    const view = this.currentTaskView();
    const f = Object.assign({ scope: "all", tags: [], status: "open", date: "any" }, view.filter || {});

    const header = pane.createDiv("ot-list-header");
    if (withBack) {
      const back = header.createDiv("clickable-icon ot-back");
      setIcon(back, "chevron-left");
      back.onclick = () => this.select(null);
    }
    const merged = p.calendarMerged();
    paintIcon(header.createSpan("ot-list-icon"), merged ? "calendar" : "circle-check", "#8E8E93");
    header.createSpan({ cls: "ot-list-title", text: merged ? "Calendar" : "Tasks" });
    const countEl = header.createSpan({ cls: "ot-list-count", text: "" });
    header.createDiv("ot-spacer");
    if (!withBack) {
      const close = header.createDiv("clickable-icon ot-list-close");
      setIcon(close, "panel-right-close");
      close.setAttr("aria-label", "Hide note list");
      close.onclick = () => this.setListClosed(true);
    }

    this.taskTabsBar(pane, view, f);
    if (merged && !p.settings.calendarTipSeen) {
      const tip = pane.createDiv("ot-hint ot-cal-tip");
      setIcon(tip.createSpan("ot-hint-icon"), "sparkles");
      tip.createDiv({ cls: "ot-hint-text", text: "Your tasks live here now: Today, Week, Month and All, next to Daily notes. Right-click a tab to edit it; double-click a day to add a task." });
      const ok = tip.createEl("button", { text: "Got it" });
      ok.onclick = async () => { p.settings.calendarTipSeen = true; await p.saveSettings(false); tip.remove(); };
    }

    const body = pane.createDiv("ot-list ot-task-pane");
    const tv = Object.create(TasksView.prototype);
    Object.assign(tv, { plugin: p, app: this.app, scope: f.scope, collapsed: (this.taskCollapsed ||= new Set(["done"])), render: () => this.render(),
      _addState: (this.taskAddState ||= {}), addBoxes: new Map(), dateField: view.dateField || "any",
      addTag: f.tags?.[0] || (f.scope !== "all" && !/\s/.test(p.labelFor(f.scope)) ? p.labelFor(f.scope) : null) });
    const seq = (this._taskSeq = (this._taskSeq || 0) + 1);
    p.collectTasks().then((all) => {
      if (seq !== this._taskSeq || !body.isConnected) return;
      const today = moment().format("YYYY-MM-DD");
      const tags = (f.tags || []).map((t) => String(t).replace(/^#/, "").toLowerCase()).filter(Boolean);
      const tasks = all.filter((t) => {
        if (!p.taskInType(t, f.scope)) return false;
        if (f.status === "open" && t.done) return false;
        if (f.status === "done" && !t.done) return false;
        if (tags.length && !t.tags.some((x) => tags.includes(String(x).toLowerCase()))) return false;
        const d = tv.dateOf(t);
        if (f.date === "dated" && !d) return false;
        if (f.date === "undated" && d) return false;
        if (f.date === "overdue" && !(d && d < today && !t.done)) return false;
        return true;
      });
      countEl.setText(String(tasks.filter((t) => !t.done).length));
      const layout = view.layout || "list";
      if (layout === "today") this.paneToday(body, tv, tasks);
      else if (layout === "week") this.paneWeek(body, tv, tasks);
      else if (layout === "month") this.paneMonth(body, tv, tasks);
      else {
        // List shows completed tasks only if the view's filter asks for them
        const keep = p.settings.taskShowDone;
        p.settings.taskShowDone = f.status !== "open";
        tv.renderList(body, tasks);
        p.settings.taskShowDone = keep;
        if (!tasks.length) body.createDiv({ cls: "ot-empty", text: this.noTasksText() });
      }
      body.ondblclick = (evt) => {
        if (evt.target !== body && !evt.target.closest(".ot-empty")) return;
        const first = { today: "p-today", month: "p-sel", list: "today" }[layout];
        if (first) tv.startAdd(first, layout === "month" ? (this.taskCursor || moment()).format("YYYY-MM-DD") : moment().format("YYYY-MM-DD"));
      };
      if (this._taskScroll && this._taskScrollView === view.id) body.scrollTop = this._taskScroll;
      body.onscroll = () => { this._taskScroll = body.scrollTop; this._taskScrollView = view.id; };
    });
  }
  /** the view tabs (and, when Calendar and Tasks are one, a Daily notes tab first) */
  taskTabsBar(pane, view, f) {
    const p = this.plugin;
    const views = this.taskPanelViews();
    const daily = p.calendarMerged() && (p.settings.taskPanelView === "daily" || p.hasDailyNotes());
    const isDaily = !view;
    const bar = pane.createDiv("ot-task-tools");
    const tabs = bar.createDiv("ot-task-tabs");
    if (daily) {
      const t = tabs.createDiv({ cls: "ot-task-tab" + (isDaily ? " is-active" : "") });
      setIcon(t.createSpan("ot-task-tab-icon"), "notebook");
      t.createSpan({ cls: "ot-task-tab-name", text: "Daily notes" });
      t.onclick = async () => { p.settings.taskPanelView = "daily"; await p.saveSettings(false); this.render(); };
    }
    for (const v of views) {
      const t = tabs.createDiv({ cls: "ot-task-tab" + (!isDaily && v.id === view.id ? " is-active" : "") });
      setIcon(t.createSpan("ot-task-tab-icon"), v.icon || "list-checks");
      t.createSpan({ cls: "ot-task-tab-name", text: v.name });
      t.onclick = async () => { p.settings.taskPanelView = v.id; this.taskCursor = null; await p.saveSettings(false); this.render(); };
      t.oncontextmenu = (evt) => this.taskViewMenu(evt, v);
    }
    const add = tabs.createDiv("clickable-icon ot-task-tab-add");
    setIcon(add, "plus");
    add.setAttr("aria-label", "New view");
    add.onclick = () => {
      const v = { id: "v" + Date.now().toString(36), name: "New view", icon: "list-checks", layout: "list", filter: { scope: "all", tags: [], status: "open", date: "any" } };
      new TaskViewModal(p, v, async (saved) => { views.push(saved); p.settings.taskPanelView = saved.id; await p.saveSettings(false); this.render(); }).open();
    };
    const acts = bar.createDiv("ot-task-acts");
    const btn = (icon, tip, fn) => {
      const b = acts.createDiv("clickable-icon ot-head-btn");
      setIcon(b, icon);
      b.setAttr("aria-label", tip);
      b.onclick = fn;
      return b;
    };
    if (isDaily) return bar;
    if (p.settings.taskSource === "tasknotes" && p.taskNotes()) btn("plus-circle", "New task", () => this.app.commands.executeCommandById("tasknotes:create-new-task"));
    btn("sliders-horizontal", "Edit this view", (evt) => this.taskViewMenu(evt, view));
    btn("maximize-2", "Open full view", () => {
      const mode = { today: "day", week: "week", month: "month", list: "list" }[view.layout] || "list";
      const pr = p.taskPrefs(f.scope); pr.mode = mode; pr.dateField = view.dateField || "any";
      p.saveSettings(false).then(() => p.openTasks(f.scope));
    });

    return bar;
  }

  /** a small link to the daily note of a date (creates it on click when missing) */
  dailyChip(parent, m) {
    const p = this.plugin;
    const file = this.app.vault.getAbstractFileByPath(p.dailyPath(m));
    const c = parent.createDiv("ot-daily-chip" + (file ? " has-note" : ""));
    setIcon(c.createSpan("ot-task-mi"), file ? "notebook" : "notebook-pen");
    c.createSpan({ text: file ? "Daily note" : "Create daily note" });
    c.setAttr("aria-label", m.format("dddd, LL"));
    c.onclick = (evt) => { evt.stopPropagation(); p.openDaily(m.clone(), evt); };
    return c;
  }

  noTasksText() {
    const p = this.plugin;
    const src = p.settings.taskSource;
    if (src === "tasknotes" && !p.taskNotes()) return "Task source is TaskNotes, but the TaskNotes plugin isn't enabled.";
    return "No tasks.";
  }
  paneToday(body, tv, tasks) {
    const today = moment();
    const key = today.format("YYYY-MM-DD");
    const head = body.createDiv("ot-pane-day-head");
    head.createDiv({ cls: "ot-pane-day-big", text: today.format("D") });
    const hd = head.createDiv();
    hd.createDiv({ cls: "ot-pane-day-dow", text: today.format("dddd") });
    hd.createDiv({ cls: "ot-pane-day-month", text: today.format("MMMM YYYY") });
    head.createDiv("ot-spacer");
    this.dailyChip(head, today);
    const overdue = tasks.filter((t) => !t.done && tv.dateOf(t) && tv.dateOf(t) < key)
      .sort((a, b) => String(tv.dateOf(a)).localeCompare(String(tv.dateOf(b))));
    if (overdue.length) tv.group(body, "p-overdue", "Overdue", overdue, { warn: true });
    tv.group(body, "p-today", "Today", tv.byDay(tasks).get(key) || [], { hideDate: true, always: true, addDate: key });
  }
  paneWeek(body, tv, tasks) {
    const base = this.taskCursor || moment().startOf("day");
    const start = tv.weekStart(base);
    const nav = body.createDiv("ot-pane-nav");
    const prev = nav.createDiv("clickable-icon"); setIcon(prev, "chevron-left");
    nav.createDiv({ cls: "ot-pane-nav-label", text: `${start.format("MMM D")} – ${start.clone().add(6, "day").format(start.clone().add(6, "day").isSame(start, "month") ? "D" : "MMM D")}` });
    const next = nav.createDiv("clickable-icon"); setIcon(next, "chevron-right");
    const go = (n) => { this.taskCursor = start.clone().add(n, "week"); this.render(); };
    prev.onclick = () => go(-1); next.onclick = () => go(1);
    if (!start.isSame(tv.weekStart(moment()), "day")) {
      const t = nav.createDiv({ cls: "ot-pane-today-btn", text: "Today" });
      t.onclick = () => { this.taskCursor = null; this.render(); };
    }
    const days = tv.byDay(tasks);
    const todayKey = moment().format("YYYY-MM-DD");
    for (let i = 0; i < 7; i++) {
      const d = start.clone().add(i, "day"), key = d.format("YYYY-MM-DD");
      const list = days.get(key) || [];
      const sec = body.createDiv("ot-pane-wday" + (key === todayKey ? " is-today" : "") + (list.length ? "" : " is-empty"));
      const h = sec.createDiv("ot-pane-wday-head");
      h.createSpan({ cls: "ot-pane-wday-num", text: d.format("D") });
      h.createSpan({ cls: "ot-pane-wday-dow", text: key === todayKey ? "Today" : d.format("dddd") });
      if (list.length) h.createSpan({ cls: "ot-tasks-group-n", text: String(list.length) });
      const dn = this.app.vault.getAbstractFileByPath(this.plugin.dailyPath(d));
      const di = h.createSpan("clickable-icon ot-pane-wday-note" + (dn ? " has-note" : ""));
      setIcon(di, dn ? "notebook" : "notebook-pen");
      di.setAttr("aria-label", dn ? "Open daily note" : "Create daily note");
      di.onclick = (evt) => { evt.stopPropagation(); this.plugin.openDaily(d.clone(), evt); };
      const plus = h.createSpan("clickable-icon ot-tasks-group-add");
      setIcon(plus, "plus");
      plus.setAttr("aria-label", "Add a task on this day");
      plus.onclick = (evt) => { evt.stopPropagation(); tv.startAdd("wd-" + key, key); };
      const box = sec.createDiv("ot-tasks-list");
      for (const t of list) tv.taskRow(box, t, { hideDate: true });
      tv.addSlot("wd-" + key, box, key);
      sec.ondblclick = (evt) => { if (!evt.target.closest(".ot-task-row, .ot-task-add")) tv.startAdd("wd-" + key, key); };
    }
  }
  paneMonth(body, tv, tasks) {
    const sel = this.taskCursor || moment().startOf("day");
    const first = sel.clone().startOf("month");
    const nav = body.createDiv("ot-pane-nav");
    const prev = nav.createDiv("clickable-icon"); setIcon(prev, "chevron-left");
    nav.createDiv({ cls: "ot-pane-nav-label", text: first.format("MMMM YYYY") });
    const next = nav.createDiv("clickable-icon"); setIcon(next, "chevron-right");
    const go = (n) => { this.taskCursor = first.clone().add(n, "month"); this.render(); };
    prev.onclick = () => go(-1); next.onclick = () => go(1);
    if (!sel.isSame(moment(), "day")) {
      const t = nav.createDiv({ cls: "ot-pane-today-btn", text: "Today" });
      t.onclick = () => { this.taskCursor = null; this.render(); };
    }
    const days = tv.byDay(tasks);
    const start = tv.weekStart(first);
    const weeks = Math.ceil((first.diff(start, "days") + first.daysInMonth()) / 7);
    const cal = body.createDiv("ot-mini-cal");
    for (let i = 0; i < 7; i++) cal.createDiv({ cls: "ot-mini-dow", text: start.clone().add(i, "day").format("dd").slice(0, 2) });
    const todayKey = moment().format("YYYY-MM-DD"), selKey = sel.format("YYYY-MM-DD");
    for (let i = 0; i < weeks * 7; i++) {
      const d = start.clone().add(i, "day"), key = d.format("YYYY-MM-DD");
      const c = cal.createDiv("ot-mini-day");
      if (!d.isSame(first, "month")) c.addClass("is-other");
      if (key === todayKey) c.addClass("is-today");
      if (key === selKey) c.addClass("is-selected");
      if (this.app.vault.getAbstractFileByPath(this.plugin.dailyPath(d))) c.addClass("has-note");
      c.createDiv({ cls: "ot-mini-num", text: String(d.date()) });
      const list = days.get(key) || [];
      const open = list.filter((t) => !t.done).length;
      const dots = c.createDiv("ot-mini-dots");
      for (let k = 0; k < Math.min(list.length, 3); k++) dots.createSpan({ cls: "ot-mini-dot" + (k >= open ? " is-done" : "") + (key < todayKey && k < open ? " is-late" : "") });
      if (list.length) c.setAttr("aria-label", `${list.length} task${list.length > 1 ? "s" : ""}`);
      // the first click redraws the calendar, so a second click on the same day within 450 ms counts as a double-click
      c.onclick = () => {
        const last = this._dayClick;
        this._dayClick = { key, t: Date.now() };
        if (last && last.key === key && Date.now() - last.t < 450) tv.addState().open = "p-sel";
        this.taskCursor = d.clone();
        this.render();
      };
    }
    const list = days.get(selKey) || [];
    this.dailyChip(body.createDiv("ot-pane-sel-note"), sel);
    tv.group(body, "p-sel", selKey === todayKey ? "Today" : sel.format("dddd, MMM D"), list, { hideDate: true, always: true, addDate: selKey });
  }
  taskViewMenu(evt, v) {
    const p = this.plugin, views = this.taskPanelViews();
    const m = new Menu();
    for (const [val, t, ic] of [["due", "By due date", "calendar"], ["scheduled", "By scheduled date", "calendar-clock"], ["any", "Due, else scheduled", "calendar-range"]])
      m.addItem((i) => i.setTitle(t).setIcon(ic).setChecked((v.dateField || "any") === val).onClick(async () => { v.dateField = val; await p.saveSettings(false); this.render(); }));
    m.addSeparator();
    m.addItem((i) => i.setTitle("Edit view…").setIcon("pencil").onClick(() =>
      new TaskViewModal(p, v, async (saved) => { Object.assign(v, saved); await p.saveSettings(false); this.render(); }).open()));
    m.addItem((i) => i.setTitle("Duplicate").setIcon("copy").onClick(async () => {
      const c = { ...v, id: "v" + Date.now().toString(36), name: v.name + " copy", filter: { ...(v.filter || {}) } };
      views.splice(views.indexOf(v) + 1, 0, c); p.settings.taskPanelView = c.id; await p.saveSettings(false); this.render();
    }));
    const idx = views.indexOf(v);
    if (idx > 0) m.addItem((i) => i.setTitle("Move left").setIcon("arrow-left").onClick(async () => { views.splice(idx, 1); views.splice(idx - 1, 0, v); await p.saveSettings(false); this.render(); }));
    if (idx < views.length - 1) m.addItem((i) => i.setTitle("Move right").setIcon("arrow-right").onClick(async () => { views.splice(idx, 1); views.splice(idx + 1, 0, v); await p.saveSettings(false); this.render(); }));
    if (views.length > 1) {
      m.addSeparator();
      m.addItem((i) => { i.setTitle("Delete view").setIcon("trash-2").onClick(async () => {
        views.splice(views.indexOf(v), 1); if (p.settings.taskPanelView === v.id) p.settings.taskPanelView = views[0].id;
        await p.saveSettings(false); this.render();
      }); i.setWarning?.(true); });
    }
    m.addSeparator();
    m.addItem((i) => i.setTitle("Reset to default views").setIcon("rotate-ccw").onClick(async () => {
      p.settings.taskPanelViews = null; p.settings.taskPanelView = "today"; await p.saveSettings(false); this.render();
    }));
    m.showAtMouseEvent(evt);
  }

  renderList(pane, withBack = false) {
    const p = this.plugin;
    const key = this.selected;
    if (!key) {
      const close = pane.createDiv("clickable-icon ot-list-close ot-list-close-floating");
      setIcon(close, "panel-right-close");
      close.setAttr("aria-label", "Hide note list");
      close.onclick = () => this.setListClosed(true);
      pane.createDiv({ cls: "ot-empty ot-list-empty", text: "Select an object type" });
      return;
    }
    if (key === "smart:tasks") return this.renderTaskPane(pane, withBack);
    if (key === "smart:calendar" && p.calendarMerged() && p.settings.taskPanelView !== "daily") return this.renderTaskPane(pane, withBack);
    const fk = p.parseFolderKey(key);
    const isType = !key.includes(":") || !!fk;
    const isCal = key === "smart:calendar";
    const isRecent = key === "smart:recent";
    const files = isRecent ? p.filesFor(key) : isCal
      ? p.filesFor(key).map((f) => [f, p.dailyDate(f).valueOf()]).sort((a, b) => b[1] - a[1]).map((x) => x[0])
      : this.sortedFiles(key);
    const label = p.labelFor(key);

    const header = pane.createDiv("ot-list-header");
    if (withBack) {
      const back = header.createDiv("clickable-icon ot-back");
      setIcon(back, "chevron-left");
      back.onclick = () => this.select(null);
    }
    paintIcon(header.createSpan("ot-list-icon"), p.iconFor(key), key.startsWith("smart:") ? "#8E8E93" : p.colorFor(key));
    if (fk) {
      const root = p.typeRoot(fk.type);
      const crumbs = header.createSpan({ cls: "ot-list-crumbs" });
      const tl = crumbs.createSpan({ cls: "ot-crumb", text: p.labelFor(fk.type) });
      tl.onclick = () => this.select(fk.type);
      const rel = fk.path.slice(root ? root.length + 1 : 0).split("/");
      rel.forEach((seg, i) => {
        crumbs.createSpan({ cls: "ot-crumb-sep", text: "›" });
        const path = (root ? root + "/" : "") + rel.slice(0, i + 1).join("/");
        const c = crumbs.createSpan({ cls: "ot-crumb" + (i === rel.length - 1 ? " ot-list-title" : ""), text: seg });
        if (i < rel.length - 1) c.onclick = () => this.select(p.folderKey(fk.type, path));
      });
    } else header.createSpan({ cls: "ot-list-title", text: label });
    header.createSpan({ cls: "ot-list-count", text: String(files.length) });
    if (!withBack) {
      const close = header.createDiv("clickable-icon ot-list-close");
      setIcon(close, "panel-right-close");
      close.setAttr("aria-label", "Hide note list");
      close.onclick = () => this.setListClosed(true);
    }
    header.createDiv("ot-spacer");
    if (isCal && p.calendarMerged()) this.taskTabsBar(pane, null, null);

    const tools = createDiv("ot-list-tools");
    const hbtn = (icon, tip, fn) => {
      const b = tools.createDiv("clickable-icon ot-head-btn");
      setIcon(b, icon);
      b.setAttr("aria-label", tip);
      b.onclick = fn;
      return b;
    };
    const pr = isCal || isRecent ? { ...this.listPrefs(key), group: "none" } : this.listPrefs(key);
    if (!isCal && !isRecent) hbtn("arrow-up-down", "Sort", (evt) => {
      const m = new Menu();
      m.addItem((i) => i.setTitle("Sort by").setIsLabel?.(true) ?? i.setTitle("Sort by").setDisabled(true));
      for (const [v, t, ic] of [["title", "Title", "type"], ["created", "Created time", "calendar-plus"], ["edited", "Last edited time", "pencil"]]) {
        m.addItem((i) => i.setTitle(t).setIcon(ic).setChecked(pr.sort === v).onClick(() => this.setListPref(key, { sort: v })));
      }
      m.addSeparator();
      m.addItem((i) => i.setTitle("Ascending").setIcon("arrow-up").setChecked(pr.dir === "asc").onClick(() => this.setListPref(key, { dir: "asc" })));
      m.addItem((i) => i.setTitle("Descending").setIcon("arrow-down").setChecked(pr.dir === "desc").onClick(() => this.setListPref(key, { dir: "desc" })));
      m.showAtMouseEvent(evt);
    });
    const gb = isCal || isRecent ? null : hbtn("layers", "Group by", (evt) => {
      const m = new Menu();
      m.addItem((i) => i.setTitle("Group by").setIsLabel?.(true) ?? i.setTitle("Group by").setDisabled(true));
      m.addItem((i) => i.setTitle("No group").setIcon("list").setChecked(pr.group === "none").onClick(() => this.setListPref(key, { group: "none" })));
      m.addItem((i) => i.setTitle("Date").setIcon("calendar").setChecked(pr.group === "date").onClick(() => this.setListPref(key, { group: "date" })));
      if (!key.startsWith("smart:")) m.addItem((i) => i.setTitle("Folder").setIcon("folder").setChecked(pr.group === "folder").onClick(() => this.setListPref(key, { group: "folder" })));
      const props = this.groupableProps(files);
      if (props.length) m.addSeparator();
      for (const k of props) {
        m.addItem((i) => i.setTitle(k).setIcon("tag").setChecked(pr.group === "prop:" + k).onClick(() => this.setListPref(key, { group: "prop:" + k })));
      }
      m.showAtMouseEvent(evt);
    });
    gb?.toggleClass("is-active", pr.group !== "none");
    if (isCal) hbtn("calendar-plus", "Open today's note", (evt) => p.openDaily(moment(), evt));
    hbtn("sliders-horizontal", "Show in list", (evt) => {
      const m = new Menu();
      const label = (t) => m.addItem((i) => i.setTitle(t).setIsLabel?.(true) ?? i.setTitle(t).setDisabled(true));
      label("Preview");
      // preview is on (two lines) or off
      m.addItem((i) => i.setTitle("Show").setChecked(pr.preview > 0).onClick(() => this.setListPref(key, { preview: 2 })));
      m.addItem((i) => i.setTitle("None").setChecked(!(pr.preview > 0)).onClick(() => this.setListPref(key, { preview: 0 })));
      m.addSeparator();
      m.addItem((i) => i.setTitle("Tags").setIcon("hash").setChecked(!!pr.tags).onClick(() => this.setListPref(key, { tags: !pr.tags })));
      const cands = [...new Set([...(pr.props || []), ...this.displayProps(files)])];
      if (cands.length) { m.addSeparator(); label("Properties"); }
      for (const k of cands) {
        const on = (pr.props || []).includes(k);
        m.addItem((i) => i.setTitle(k).setIcon("list").setChecked(on).onClick(() =>
          this.setListPref(key, { props: on ? pr.props.filter((x) => x !== k) : [...(pr.props || []), k] })));
      }
      m.showAtMouseEvent(evt);
    });
    hbtn(p.settings.listMode === "grid" ? "list" : "layout-grid", "Toggle list / grid", async () => {
      p.settings.listMode = p.settings.listMode === "grid" ? "list" : "grid";
      await p.saveSettings(false); this.render();
    });
    if (isType) hbtn("square-pen", `New ${label}`, () => p.createObject(key));

    const srow = pane.createDiv("ot-list-search-row");
    const sw = srow.createDiv("ot-list-search");
    srow.appendChild(tools);
    setIcon(sw.createSpan("ot-search-icon"), "search");
    const search = sw.createEl("input", { type: "text", placeholder: `Search ${label.toLowerCase()}` });
    search.value = this.query;

    if (isCal) this.renderCalendar(pane, files);
    const listEl = pane.createDiv("ot-list");
    listEl.toggleClass("is-grid", p.settings.listMode === "grid");
    const draw = () => {
      listEl.empty();
      const q = this.query.toLowerCase();
      const visible = files.filter((f) => !q || f.basename.toLowerCase().includes(q));
      const metaTs = (f) => this.sortTime(f, pr.sort === "created" ? "created" : "edited");
      // render in chunks: big types used to build every row up front
      const limit = this.listLimit || 60;
      let shown = 0, hidden = 0;
      const put = (parent, f) => {
        if (shown >= limit) { hidden++; return; }
        shown++;
        if (isCal && p.settings.listMode !== "grid") return this.renderItem(parent, f, p.dailyDate(f).format("dddd, LL"), pr);
        return p.settings.listMode === "grid" ? this.renderCard(parent, f, key) : this.renderItem(parent, f, metaTs(f), pr);
      };
      const finish = () => {
        if (!hidden) return;
        const more = listEl.createDiv("ot-show-more");
        more.setText(`Show ${Math.min(hidden, 100)} more · ${hidden} left`);
        more.onclick = () => { this.listLimit = limit + 100; draw(); };
        const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { io.disconnect(); more.click(); } }, { root: listEl, rootMargin: "300px" });
        io.observe(more);
      };
      if (isCal && !visible.length) {
        listEl.createDiv({ cls: "ot-cal-empty", text: q ? "No daily notes match." : "No daily notes yet. Click a day to create one." });
      } else if (pr.group === "none") {
        const wrap = listEl.createDiv("ot-group-items");
        visible.forEach((f) => put(wrap, f));
      } else if (pr.group === "folder") {
        // nested tree: folders inside folders
        const fk = p.parseFolderKey(key);
        const base = fk ? fk.path : p.typeRoot(this.prefKey(key));
        const mk = (name, path) => ({ name, path, files: [], kids: new Map(), total: 0 });
        const root = mk("", base);
        for (const f of visible) {
          const fp = f.parent?.path || "";
          const rel = base && fp.startsWith(base + "/") ? fp.slice(base.length + 1) : (fp === base ? "" : fp);
          let node = root;
          node.total++;
          if (rel) for (const seg of rel.split("/")) {
            if (!node.kids.has(seg)) node.kids.set(seg, mk(seg, node.path ? node.path + "/" + seg : seg));
            node = node.kids.get(seg);
            node.total++;
          }
          node.files.push(f);
        }
        this.collapsed ||= new Set();
        this.opened ||= new Set();
        const renderNode = (parent, node, depth) => {
          const kids = [...node.kids.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
          for (const kid of kids) {
            const id = "folder|" + kid.path;
            const closed = !this.opened.has(id);
            const h = parent.createDiv("ot-group ot-folder-group");
            h.dataset.depth = String(depth);
            h.toggleClass("is-collapsed", closed);
            setIcon(h.createSpan("ot-group-chev"), "chevron-down");
            setIcon(h.createSpan("ot-group-icon"), closed ? "folder" : "folder-open");
            h.createSpan({ cls: "ot-group-label", text: kid.name });
            h.createSpan({ cls: "ot-group-count", text: String(kid.total) });
            h.onclick = () => { closed ? this.opened.add(id) : this.opened.delete(id); draw(); };
            const wrap = parent.createDiv("ot-group-items ot-folder-items");
            if (!closed) renderNode(wrap, kid, depth + 1);
          }
          node.files.forEach((f) => put(parent, f));
        };
        renderNode(listEl, root, 0);
      } else {
        const groups = new Map();
        for (const f of visible) {
          const g = this.groupOf(f, pr, key);
          if (!groups.has(g.label)) groups.set(g.label, { order: g.order, files: [] });
          const e = groups.get(g.label);
          e.files.push(f);
          if (typeof g.order === "number") e.order = Math.min(e.order, g.order);
        }
        const entries = [...groups.entries()].sort((a, b) => typeof a[1].order === "number"
          ? a[1].order - b[1].order
          : String(a[1].order).localeCompare(String(b[1].order), undefined, { numeric: true }));
        this.collapsed ||= new Set();
        this.opened ||= new Set();
        for (const [label, g] of entries) {
          const id = pr.group + "|" + label;
          const h = listEl.createDiv("ot-group" + (pr.group === "date" ? " is-date" : ""));
          setIcon(h.createSpan("ot-group-chev"), "chevron-down");
          if (pr.group !== "date") {
            const gi = h.createSpan("ot-group-icon");
            setIcon(gi, "tag");
          }
          const lab = h.createSpan("ot-group-label");
          if (pr.group === "folder" && label.includes("/")) {
            const parts = label.split("/");
            lab.createSpan({ cls: "ot-group-parent", text: parts.slice(0, -1).join(" › ") + " › " });
            lab.createSpan({ text: parts[parts.length - 1] });
          } else lab.setText(label);
          h.createSpan({ cls: "ot-group-count", text: String(g.files.length) });
          const wrap = listEl.createDiv("ot-group-items");
          const dateGroup = pr.group === "date";
          const closed = dateGroup ? this.collapsed.has(id) : !this.opened.has(id);
          h.toggleClass("is-collapsed", closed);
          if (!closed) g.files.forEach((f) => put(wrap, f));
          h.onclick = () => {
            if (dateGroup) closed ? this.collapsed.delete(id) : this.collapsed.add(id);
            else closed ? this.opened.add(id) : this.opened.delete(id);
            draw();
          };
        }
      }
      finish();
      listEl.toggleClass("is-flat", !listEl.querySelector(".ot-group-items"));
      this.markActive();
    };
    search.oninput = () => { this.query = search.value; this.listLimit = 0; draw(); };
    draw();
  }

  bindFile(el, file) {
    el.dataset.path = file.path;
    el.onclick = (evt) => this.plugin.openFromPanel(file, evt);
    el.onmouseover = (evt) => this.app.workspace.trigger("hover-link", {
      event: evt, source: VIEW_TYPE, hoverParent: this, targetEl: el, linktext: file.path,
    });
    el.oncontextmenu = (evt) => this.noteMenu(evt, file);
    el.draggable = !Platform.isMobile;
    el.ondragstart = (evt) => {
      const dm = this.app.dragManager;
      if (dm) dm.onDragStart(evt, dm.dragFile(evt, file));
    };
  }

  /** frontmatter properties these files use (candidates for "Show in list") */
  displayProps(files) {
    const cnt = new Map();
    const skip = new Set([this.plugin.prop, "position", "tags", "aliases", "cssclasses", ...THUMB_KEYS]);
    for (const f of files.slice(0, 400)) {
      for (const k of Object.keys(this.app.metadataCache.getFileCache(f)?.frontmatter || {})) if (!skip.has(k)) cnt.set(k, (cnt.get(k) || 0) + 1);
    }
    return [...cnt.entries()].filter(([, c]) => c >= Math.max(1, files.length * 0.1)).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
  }

  /** plain-text start of a note for the list preview (cached per mtime) */
  async previewText(file) {
    this._previews ||= new Map();
    const hit = this._previews.get(file.path);
    if (hit && hit.mtime === file.stat.mtime) return hit.text;
    if (file.extension !== "md") return "";
    let body = await this.app.vault.cachedRead(file);
    const fmEnd = this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end?.offset;
    if (fmEnd) body = body.slice(fmEnd);
    const text = body.slice(0, 2000)
      .replace(/```[\s\S]*?(```|$)/g, " ")
      .replace(/%%[\s\S]*?(%%|$)/g, " ")
      .replace(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[\[([^\]|]*\|)?([^\]]*)\]\]/g, "$2")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+\[.\]\s+|[-*+]\s+|\d+\.\s+)/gm, "")
      .replace(/[*_~=`]+/g, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ").trim().slice(0, 280);
    this._previews.set(file.path, { mtime: file.stat.mtime, text });
    return text;
  }

  renderItem(listEl, file, ts, disp = {}) {
    const item = listEl.createDiv("ot-item");
    const text = item.createDiv("ot-item-text");
    text.createDiv({ cls: "ot-item-title", text: file.basename });
    if (disp.preview > 0 && file.extension === "md") {
      const pv = text.createDiv("ot-item-preview");
      pv.style.setProperty("--ot-lines", "2");
      // read the note only when its row is (about to be) on screen
      this._pvIO ||= new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          this._pvIO?.unobserve(e.target);
          const f = e.target._otFile;
          if (f) this.previewText(f).then((t) => { if (t) e.target.setText(t); else e.target.remove(); });
        }
      }, { rootMargin: "250px" });
      pv._otFile = file;
      this._pvIO.observe(pv);
    }
    const meta = text.createDiv("ot-item-meta");
    meta.createSpan({ text: typeof ts === "string" ? ts : relTime(ts) });
    const cache = this.app.metadataCache.getFileCache(file);
    for (const k of disp.props || []) {
      let v = cache?.frontmatter?.[k];
      if (v == null || v === "" || typeof v === "object" && !Array.isArray(v)) continue;
      v = (Array.isArray(v) ? v : [v]).filter((x) => x != null && typeof x !== "object").map(cleanLink).join(", ");
      if (!v) continue;
      const c = meta.createSpan({ cls: "ot-item-prop", text: typeof v === "string" && v.length > 40 ? v.slice(0, 40) + "…" : String(v) });
      c.setAttr("aria-label", k);
    }
    if (disp.tags) for (const t of [...new Set(getAllTags(cache || {}) || [])].slice(0, 5)) meta.createSpan({ cls: "ot-item-tag", text: t });
    // file type at the bottom right, small like the date
    if (file.extension !== "md") meta.createSpan({ cls: "ot-ext-badge", text: file.extension.toUpperCase() });
    const thumb = this.plugin.thumbnailFor(file);
    if (thumb) item.createEl("img", { cls: "ot-thumb", attr: { src: thumb, loading: "lazy" } });
    this.bindFile(item, file);
  }

  renderCard(listEl, file, key) {
    const p = this.plugin;
    const card = listEl.createDiv("ot-item ot-grid-card");
    const cover = card.createDiv("ot-card-cover");
    const src = p.thumbnailFor(file);
    if (src) cover.createEl("img", { attr: { src, loading: "lazy" } });
    else paintIcon(cover.createDiv("ot-card-placeholder"), p.iconFor(p.typeOfFile(file) || key), p.colorFor(p.typeOfFile(file) || key));
    card.createDiv({ cls: "ot-card-title", text: file.basename });
    if (file.extension !== "md") card.createDiv("ot-card-ext").createSpan({ cls: "ot-ext-badge", text: file.extension.toUpperCase() });
    this.bindFile(card, file);
  }

  renderCalendar(pane, files) {
    const p = this.plugin;
    const byDay = new Map(files.map((f) => [p.dailyDate(f).format("YYYY-MM-DD"), f]));
    const month = (this.calMonth ||= moment().startOf("month"));
    const cal = pane.createDiv("ot-cal");
    const head = cal.createDiv("ot-cal-head");
    const title = head.createDiv("ot-cal-title");
    title.createSpan({ cls: "ot-cal-month", text: month.format("MMMM") });
    title.createSpan({ cls: "ot-cal-year", text: month.format("YYYY") });
    const nav = head.createDiv("ot-cal-nav");
    const go = (m) => { this.calMonth = m.clone().startOf("month"); this.render(); };
    const btn = (icon, tip, fn) => { const b = nav.createDiv("ot-cal-btn"); setIcon(b, icon); b.setAttr("aria-label", tip); b.onclick = fn; };
    btn("chevron-left", "Previous month", () => go(month.clone().subtract(1, "month")));
    const today = nav.createDiv({ cls: "ot-cal-today", text: "Today" });
    today.onclick = () => go(moment());
    btn("chevron-right", "Next month", () => go(month.clone().add(1, "month")));

    const grid = cal.createDiv("ot-cal-grid");
    const first = moment.localeData().firstDayOfWeek();
    for (let i = 0; i < 7; i++) grid.createDiv({ cls: "ot-cal-dow", text: moment().day((first + i) % 7).format("dd") });
    const offset = (month.day() - first + 7) % 7;
    const weeks = Math.ceil((offset + month.daysInMonth()) / 7);
    const d = month.clone().subtract(offset, "day");
    const todayKey = moment().format("YYYY-MM-DD");
    for (let i = 0; i < weeks * 7; i++, d.add(1, "day")) {
      const day = d.clone();
      const k = day.format("YYYY-MM-DD");
      const f = byDay.get(k);
      const cell = grid.createDiv("ot-cal-day");
      cell.createSpan({ cls: "ot-cal-num", text: String(day.date()) });
      cell.createSpan("ot-cal-dot");
      cell.toggleClass("is-outside", day.month() !== month.month());
      cell.toggleClass("is-today", k === todayKey);
      cell.toggleClass("has-note", !!f);
      if (f) cell.dataset.path = f.path;
      cell.setAttr("aria-label", day.format("LL") + (f ? "" : " · New daily note"));
      cell.onclick = (evt) => p.openDaily(day, evt);
    }
  }

  markActive() {
    const active = this.app.workspace.getActiveFile()?.path;
    this.contentEl.querySelectorAll(".ot-cal-day").forEach((el) => el.toggleClass("is-active", !!el.dataset.path && el.dataset.path === active));
    this.contentEl.querySelectorAll(".ot-item").forEach((el) => el.toggleClass("is-active", el.dataset.path === active));
    this.contentEl.querySelectorAll(".ot-file-row").forEach((el) => el.toggleClass("is-active-note", el.dataset.path === active));
  }
}

/* ───────────────────────────── Modals ───────────────────────────── */

class BannerPickerModal extends SuggestModal {
  constructor(plugin, file) {
    super(plugin.app);
    this.plugin = plugin; this.file = file;
    this.setPlaceholder("Search vault images, or paste an image URL");
    this.modalEl.addClass("ot-banner-modal");
    this.images = plugin.app.vault.getFiles().filter((f) => IMG_EXT.includes(f.extension.toLowerCase()))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
  }
  getSuggestions(q) {
    q = q.trim();
    if (/^https?:\/\//.test(q)) return [{ url: q }];
    const ql = q.toLowerCase();
    const out = this.images.filter((f) => !ql || f.path.toLowerCase().includes(ql)).slice(0, 60).map((f) => ({ file: f }));
    // borrow a banner from a folder above or from an object type
    if (this.file && !this.plugin.isFolderNote?.(this.file)) {
      const srcs = this.plugin.bannerSources(this.file)
        .filter((x) => !ql || "default banner same as".includes(ql) || x.label.toLowerCase().includes(ql));
      out.unshift(...srcs.map((x) => ({ borrow: x })));
    }
    return out;
  }
  renderSuggestion(item, el) {
    el.addClass("ot-banner-option");
    if (item.borrow) {
      const x = item.borrow;
      if (x.src) el.createEl("img", { cls: "ot-banner-option-img", attr: { src: x.src } });
      else {
        const sw = el.createDiv("ot-banner-option-img ot-banner-option-gen");
        sw.style.setProperty("--ot-color", x.banner.color);
        setIcon(sw, x.banner.icon);
      }
      const t = el.createDiv("ot-banner-option-text");
      const cur = this.plugin.defaultBannerSource(this.file);
      t.createDiv({ text: `Same as ${x.label}` + (cur && cur.id === x.id ? "  ✓" : "") });
      t.createDiv({ cls: "ot-banner-option-path", text: x.kind });
      return;
    }
    const src = item.url || this.app.vault.getResourcePath(item.file);
    el.createEl("img", { cls: "ot-banner-option-img", attr: { src, loading: "lazy" } });
    const t = el.createDiv("ot-banner-option-text");
    t.createDiv({ text: item.url ? "Use image URL" : item.file.basename });
    t.createDiv({ cls: "ot-banner-option-path", text: item.url || item.file.parent?.path || "/" });
  }
  async onChooseSuggestion(item) {
    if (item.borrow) {
      if (this.plugin.bannerKey(this.file)) await this.plugin.setBanner(this.file, null);
      await this.plugin.setDefaultBanner(this.file, item.borrow.id);
      return;
    }
    this.plugin.setBanner(this.file, item.url || `[[${item.file.path}]]`);
  }
}

/** the banner picker, reused to pick a Tasks background */
class TaskBgModal extends BannerPickerModal {
  constructor(plugin, onPick) { super(plugin, null); this.onPick = onPick; this.setPlaceholder("Pick a background image, or paste an image URL"); }
  onChooseSuggestion(item) { this.onPick(item.url || item.file.path); }
}

class ConfirmModal extends Modal {
  constructor(plugin, title, text, cta, onOk) { super(plugin.app); Object.assign(this, { title, text, cta, onOk }); }
  onOpen() {
    this.modalEl.addClass("ot-modal");
    this.titleEl.setText(this.title);
    this.contentEl.createEl("p", { text: this.text });
    const b = this.contentEl.createDiv("ot-config-buttons");
    b.createDiv("ot-spacer");
    b.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const ok = b.createEl("button", { cls: "mod-warning", text: this.cta });
    ok.onclick = () => { this.close(); this.onOk(); };
    window.setTimeout(() => ok.focus(), 0);
  }
  onClose() { this.contentEl.empty(); }
}

/* ───────────── What's new + guide (opens once after an update) ───────────── */
const WHATS_NEW = {
  version: "1.1.0",
  items: [
    ["calendar", "Tasks now live in Calendar", "Open Calendar in the sidebar: your tasks now sit in tabs next to Daily notes — Today, Week (a section per day), Month (a calendar with dots for due tasks) and All. Each day links to its daily note. Prefer them apart? Settings → Sidebar → “Calendar and Tasks as separate rows”. Task views are yours to edit: Rename a view, change its icon, filter it by object type, tags, status or date, and choose whether tasks sit on their due or scheduled date."],
    ["sparkles", "Start here", "Don't know where to start? The Start here tab turns several folders into object types at once and lets you pick what Typefold shows. It's always in Settings → General."],
    ["mouse-pointer-click", "Add and delete tasks in place", "Double-click a day or a section to add a task right there, with that date. Right-click a task to delete it. ⤢ opens a full view with Month, Week, Day and List, and a background of your choice."],
    ["list-checks", "TaskNotes, Tasks plugin or checkboxes", "Pick where tasks come from in Settings → Tasks: TaskNotes (one note per task, added in natural language like “Call mom tomorrow 3pm #family”), the Tasks plugin (its global filter, done dates and recurrence), or every `- [ ]` checkbox in your notes with the note title, tags and due date."],
    ["inbox", "Inbox and Recents", "Inbox now holds every document outside your object types — PDFs, Office files and canvases too, not just notes. A new Recents section lists the files you opened most recently; Favorites, Recents, Object Types and Files are all foldable sections."],
    ["house", "Your own Home", "Home can open Typefold's dashboard or any note you choose. Each dashboard section can be turned off."],
    ["image", "Banners", "Borrow a banner from a folder above the note or from its object type. Fill, Fit, or drag to reposition. Image banners now always fill their box at the same height as type pages."],
    ["folder-open", "Folder notes", "Boards inside folder notes now work right away (a missing Folder.base is created for you). A new switch stops Typefold from creating folder notes automatically."],
    ["sliders-horizontal", "Settings in tabs, many more switches", "Settings are split into General, Sidebar, Notes, Home, Tasks, Types and More, with on/off switches for the ribbon buttons, status bar, chips under the title, note icons, sidebar footer, each shortcut and each Home section — plus a new “One folder open at a time” option (off by default)."],
  ],
};
const GUIDE = [
  ["folder-tree", "Folders are types", "Register a folder as an object type with “New → New type” or by right-clicking a folder. Every note inside it, subfolders included, belongs to that type — no tags or frontmatter needed. Nested folders can be types too."],
  ["panel-left", "The sidebar", "Shortcuts (Home, Inbox, Calendar) at the top, then small foldable Favorites and Recents sections, your types with their folder trees, and Files. Click a type or folder to list its notes in the second column; right-click anything for more options; drag types to reorder them."],
  ["layout-dashboard", "Type pages and folder boards", "Clicking a type opens its page: a Bases view of all its notes. Folder notes show a board of the notes in that folder. With Extended Base installed you also get Board, List and Feed views."],
  ["file-text", "Notes", "Object notes get a banner and an icon above the title and chips below it (type, folder, properties, icon and banner buttons). Properties are hidden until you click the properties chip. Related notes, grouped by type, appear at the bottom."],
  ["calendar", "Calendar and tasks", "Calendar in the sidebar holds your daily notes and your tasks. Switch views with the tabs, right-click a tab to edit it, double-click a day to add a task, right-click a task for more. ⤢ opens the big Month / Week / Day / List view."],
  ["search", "Home and search", "Home shows a greeting, your types and recent notes — or a note you choose. ⌘T (a new tab) opens a search panel with recent pages and a preview."],
  ["toggle-right", "Too much? Turn things off", "Typefold does a lot, and you don't need all of it. In Settings → Typefold you can switch off almost any part: the shortcuts, Favorites, Recents, the sidebar footer, banners, chips under the title, related notes, Home sections, ribbon buttons, the status bar, automatic folder notes… “One folder open at a time” keeps a long tree tidy. This guide stays under Settings → General."],
];
class WhatsNewModal extends Modal {
  constructor(plugin, mode = "new") { super(plugin.app); this.plugin = plugin; this.mode = mode; }
  onOpen() {
    const p = this.plugin;
    this.modalEl.addClass("ot-modal", "ot-whatsnew");
    this.titleEl.empty();
    const t = this.titleEl.createDiv("ot-whatsnew-title");
    paintIcon(t.createSpan(), "shapes", "#007AFF");
    t.createSpan({ text: `Typefold ${p.manifest.version}` });
    const calm = this.contentEl.createDiv("ot-whatsnew-calm");
    setIcon(calm.createSpan("ot-whatsnew-calm-icon"), "toggle-right");
    calm.createSpan({ text: "Feels like too much? Almost everything can be turned off — sidebar sections, banners, chips, Home sections, ribbon and status bar — in Settings → Typefold." });
    const tabs = this.contentEl.createDiv("ot-tasks-seg ot-whatsnew-tabs");
    const body = this.contentEl.createDiv("ot-whatsnew-body");
    const draw = () => {
      tabs.empty(); body.empty();
      for (const [m, label] of [["start", "Start here"], ["new", "What's new"], ["guide", "How it works"]]) {
        const b = tabs.createDiv({ cls: "ot-tasks-seg-btn" + (this.mode === m ? " is-active" : ""), text: label });
        b.onclick = () => { this.mode = m; draw(); };
      }
      if (this.mode === "start") { this.drawStart(body); body.scrollTop = 0; return; }
      const list = this.mode === "new" ? WHATS_NEW.items : GUIDE;
      for (const [icon, title, text] of list) {
        const row = body.createDiv("ot-whatsnew-item");
        paintIcon(row.createSpan(), icon, "#8E8E93");
        const tx = row.createDiv();
        tx.createDiv({ cls: "ot-whatsnew-item-title", text: title });
        tx.createDiv({ cls: "ot-whatsnew-item-text", text });
      }
      body.scrollTop = 0;
    };
    draw();
    // Obsidian moves focus once the modal is shown, which can scroll the list: start at the top
    for (const ms of [0, 60, 250]) window.setTimeout(() => { body.scrollTop = 0; }, ms);
    const foot = this.contentEl.createDiv("ot-config-buttons ot-whatsnew-foot");
    const lab = foot.createEl("label", { cls: "ot-check" });
    const cb = lab.createEl("input", { type: "checkbox" });
    cb.checked = !!p.settings.showWhatsNew;
    cb.onchange = async () => { p.settings.showWhatsNew = cb.checked; await p.saveData(p.settings); };
    lab.createSpan({ text: "Show after updates" });
    foot.createDiv("ot-spacer");
    const settings = foot.createEl("button", { text: "Open settings" });
    settings.onclick = () => { this.close(); try { this.app.setting.open(); this.app.setting.openTabById(p.manifest.id); } catch (e) {} };
    foot.createEl("button", { cls: "mod-cta", text: "Got it" }).onclick = () => this.close();
  }
  /* “Don't know where to start?” — make several types at once and pick what to show */
  drawStart(body) {
    const p = this.plugin, s = p.settings;
    const hero = body.createDiv("ot-start-hero");
    hero.createDiv({ cls: "ot-start-title", text: "Don't know where to start?" });
    hero.createDiv({ cls: "ot-start-sub", text: "Pick the folders you want as object types and choose what Typefold shows. Everything can be changed later in Settings → Typefold." });

    // 1. folders → types
    body.createDiv({ cls: "ot-start-step", text: "1 · Turn folders into object types" });
    const root = normalizePath(s.basesFolder || "Typefold");
    const taken = new Set(Object.entries(s.types).filter(([k, c]) => !k.includes(":") && c.registered).flatMap(([k]) => p.typeFolders(k)));
    const count = (fo) => { let n = 0; const walk = (f) => f.children.forEach((c) => c.extension === "md" ? n++ : c.children && walk(c)); walk(fo); return n; };
    const folders = this.app.vault.getRoot().children
      .filter((f) => f instanceof TFolder && !f.name.startsWith(".") && !f.name.startsWith("_") && f.path !== root)
      .map((f) => ({ f, n: count(f) })).filter(({ f, n }) => n > 0 || taken.has(f.path)).sort((a, b) => b.n - a.n);
    const pick = (this._pick ||= new Map());
    const list = body.createDiv("ot-start-folders");
    if (!folders.length) list.createDiv({ cls: "ot-start-none", text: "No folders yet. Create a folder for each kind of note (People, Books, Projects…), then come back here — or use “New → New type” in the sidebar." });
    folders.forEach(({ f, n }, i) => {
      const done = taken.has(f.path);
      const guess = ICON_GUESS.find(([re]) => re.test(f.name.toLowerCase()))?.[1] || SUGGESTED_ICONS[i % 20];
      const color = COLORS[i % (COLORS.length - 1)].hex;
      const row = list.createEl("label", { cls: "ot-start-folder" + (done ? " is-done" : "") });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = done || !!pick.get(f.path);
      cb.disabled = done;
      cb.onchange = () => { cb.checked ? pick.set(f.path, { icon: guess, color }) : pick.delete(f.path); updateBtn(); };
      paintIcon(row.createSpan(), guess, color);
      row.createSpan({ cls: "ot-start-folder-name", text: f.name });
      row.createSpan({ cls: "ot-start-folder-n", text: done ? "already a type" : `${n} notes` });
    });

    // 2. what to show
    body.createDiv({ cls: "ot-start-step", text: "2 · Choose what you want to see" });
    const opts = (this._opts ||= {
      openHomeOnStartup: s.openHomeOnStartup, showFavorites: s.showFavorites, showRecents: s.showRecents, showFiles: s.showFiles,
      showBanner: s.showBanner, showNoteChips: s.showNoteChips, showRelated: s.showRelated, newTabSearch: s.newTabSearch,
      useFolderNotes: s.useFolderNotes !== false, oneFolderOpen: !!s.oneFolderOpen, replaceExplorer: !!s.replaceExplorer, showRibbon: s.showRibbon,
    });
    const grid = body.createDiv("ot-start-opts");
    for (const [k, title, desc] of [
      ["replaceExplorer", "Use as file explorer", "Typefold's sidebar instead of the core one"],
      ["openHomeOnStartup", "Home on startup", "Open the Home dashboard when Obsidian starts"],
      ["showFavorites", "Favorites", "Your bookmarks in the sidebar"],
      ["showRecents", "Recents", "Files you opened lately"],
      ["showFiles", "Files section", "Images, PDFs, videos, audio and tags"],
      ["oneFolderOpen", "One folder open at a time", "Opening a folder closes the others"],
      ["showBanner", "Banners", "Cover images above the title"],
      ["showNoteChips", "Chips under the title", "Type, folder and property chips"],
      ["showRelated", "Related notes", "Backlinks grouped by type at the bottom"],
      ["useFolderNotes", "Folder notes", "Folders open their folder note (Folder notes plugin)"],
      ["newTabSearch", "Search in new tabs", "A new tab opens a quick search panel"],
      ["showRibbon", "Ribbon buttons", "Home and Typefold in the left ribbon"],
    ]) {
      const cell = grid.createEl("label", { cls: "ot-start-opt" });
      const tx = cell.createDiv("ot-start-opt-text");
      tx.createDiv({ cls: "ot-start-opt-title", text: title });
      tx.createDiv({ cls: "ot-start-opt-desc", text: desc });
      const sw = cell.createDiv("checkbox-container" + (opts[k] ? " is-enabled" : ""));
      sw.createEl("input", { type: "checkbox", attr: { tabindex: "0" } });
      cell.onclick = (e) => { e.preventDefault(); opts[k] = !opts[k]; sw.toggleClass("is-enabled", opts[k]); };
    }

    // apply
    const bar = body.createDiv("ot-start-apply");
    const btn = bar.createEl("button", { cls: "mod-cta" });
    const updateBtn = () => btn.setText(pick.size ? `Create ${pick.size} type${pick.size > 1 ? "s" : ""} and apply` : "Apply settings");
    updateBtn();
    btn.onclick = async () => {
      btn.disabled = true; btn.setText("Setting up…");
      try {
        const explorerWas = !!s.replaceExplorer;
        Object.assign(s, opts);
        await p.saveSettings(false);
        if (s.replaceExplorer && !explorerWas) p.activateView();
        let made = 0;
        for (const [path, v] of pick) {
          const label = path.split("/").pop();
          await p.registerType({ label, icon: v.icon, color: v.color, folder: path, assign: false, folderNote: "none", typePage: s.openBaseOnClick !== false });
          made++;
        }
        pick.clear();
        await p.saveSettings();
        await p.activateView();
        new Notice(made ? `Typefold is set up — ${made} object type${made > 1 ? "s" : ""} created.` : "Settings applied.");
        this.close();
      } catch (e) {
        new Notice(`Setup didn't finish: ${e.message || e}`);
        btn.disabled = false; updateBtn();
      }
    };
  }

  onClose() { this.contentEl.empty(); }
}

/** edit one sidebar Tasks view: name, icon, layout and filters */
class TaskViewModal extends Modal {
  constructor(plugin, view, onSave) {
    super(plugin.app);
    this.plugin = plugin;
    this.v = { ...view, filter: Object.assign({ scope: "all", tags: [], status: "open", date: "any" }, view.filter || {}) };
    this.onSave = onSave;
  }
  onOpen() {
    const p = this.plugin, v = this.v, f = v.filter, el = this.contentEl;
    this.modalEl.addClass("ot-modal", "ot-taskview-modal");
    this.titleEl.setText("Edit view");
    new Setting(el).setName("Name").addText((t) => t.setValue(v.name).onChange((x) => { v.name = x.trim() || "View"; }));
    const iconSet = new Setting(el).setName("Icon");
    const grid = el.createDiv("ot-taskview-icons");
    const icons = [...new Set([v.icon, "sun", "calendar", "calendar-range", "calendar-days", "calendar-clock", "list-checks", "list-todo", "circle-check", "check-check", "flag", "star", "flame", "alarm-clock", "inbox", "briefcase", "graduation-cap", "book-open", "home", "heart", "target", "rocket", "zap", "coffee", ...SUGGESTED_ICONS])].filter(Boolean).slice(0, 48);
    const drawIcons = () => {
      grid.empty();
      for (const ic of icons) {
        const b = grid.createDiv("clickable-icon ot-taskview-icon" + (ic === v.icon ? " is-active" : ""));
        setIcon(b, ic);
        b.setAttr("aria-label", ic);
        b.onclick = () => { v.icon = ic; drawIcons(); };
      }
    };
    drawIcons();
    iconSet.settingEl.after(grid);
    new Setting(el).setName("Layout").setDesc("Today: today and overdue. Week: a section per day. Month: a calendar with dots, then the picked day. List: grouped by date.")
      .addDropdown((d) => d.addOptions({ today: "Today", week: "Week", month: "Month", list: "List" }).setValue(v.layout || "list").onChange((x) => { v.layout = x; }));
    new Setting(el).setName("Place tasks by").setDesc("Which date puts a task on a day. New tasks added here get that date too.")
      .addDropdown((d) => d.addOptions({ due: "Due date", scheduled: "Scheduled date", any: "Due date, else scheduled" }).setValue(v.dateField || "any").onChange((x) => { v.dateField = x; }));
    new Setting(el).setName("Filters").setHeading();
    const types = { all: "All object types" };
    for (const t of p.visibleTypes()) types[t.key] = t.label;
    new Setting(el).setName("Object type").addDropdown((d) => d.addOptions(types).setValue(types[f.scope] ? f.scope : "all").onChange((x) => { f.scope = x; }));
    new Setting(el).setName("Tags").setDesc("Show only tasks with any of these tags (comma-separated). Empty = all.")
      .addText((t) => t.setPlaceholder("School, work").setValue((f.tags || []).join(", ")).onChange((x) => { f.tags = x.split(",").map((s) => s.trim().replace(/^#/, "")).filter(Boolean); }));
    new Setting(el).setName("Status").addDropdown((d) => d.addOptions({ open: "Open", all: "Open and completed", done: "Completed" }).setValue(f.status || "open").onChange((x) => { f.status = x; }));
    new Setting(el).setName("Date").addDropdown((d) => d.addOptions({ any: "Any", dated: "Has a date", undated: "No date", overdue: "Overdue" }).setValue(f.date || "any").onChange((x) => { f.date = x; }));
    const buttons = el.createDiv("ot-config-buttons");
    buttons.createDiv("ot-spacer");
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const save = buttons.createEl("button", { cls: "mod-cta", text: "Save" });
    save.onclick = async () => { await this.onSave(this.v); this.close(); };
  }
  onClose() { this.contentEl.empty(); }
}

class TypePickerModal extends Modal {
  constructor(plugin, onPick) { super(plugin.app); this.plugin = plugin; this.onPick = onPick; }
  onOpen() {
    const p = this.plugin;
    this.modalEl.addClass("ot-modal");
    this.titleEl.setText("New object");
    const input = this.contentEl.createEl("input", { cls: "ot-modal-input", type: "text", placeholder: "Search or create a type" });
    const list = this.contentEl.createDiv("ot-picker");
    const draw = () => {
      list.empty();
      const q = input.value.trim().toLowerCase();
      const types = p.visibleTypes().filter((t) => !q || t.label.toLowerCase().includes(q));
      for (const t of types) {
        const r = list.createDiv("ot-nav-row");
        paintIcon(r.createSpan(), p.iconFor(t.key), p.colorFor(t.key));
        r.createSpan({ cls: "ot-nav-label", text: t.label });
        r.onclick = () => { this.close(); this.onPick(t.key); };
      }
      if (q && !types.some((t) => t.key === q)) {
        const r = list.createDiv("ot-nav-row");
        paintIcon(r.createSpan(), "plus", "#8E8E93");
        r.createSpan({ cls: "ot-nav-label", text: `Create type "${input.value.trim()}"` });
        r.onclick = () => {
          const label = input.value.trim();
          p.conf(label.toLowerCase()).label = label;
          p.saveData(p.settings);
          this.close();
          new NewTypeModal(p, { label }, (key) => this.onPick(key)).open();
        };
      }
    };
    input.oninput = draw;
    input.onkeydown = (e) => { if (e.key === "Enter") list.querySelector(".ot-nav-row")?.click(); };
    draw();
    setTimeout(() => input.focus(), 0);
  }
  onClose() { this.contentEl.empty(); }
}

class QuickOpenModal extends Modal {
  constructor(plugin, leaf) {
    super(plugin.app);
    this.plugin = plugin; this.leaf = leaf;
    this.titleOnly = true; this.inType = null; this.sel = 0; this.items = []; this.showPreview = !Platform.isPhone;
  }

  candidates() {
    const p = this.plugin;
    const c = p._qoCand;
    if (c && Date.now() - c.at < 5000 && c.inType === this.inType) return c.files.slice();
    const bases = normalizePath(p.settings.basesFolder || "Typefold") + "/";
    let files = this.app.vault.getFiles().filter((f) => ["md", "canvas", "base"].includes(f.extension)
      && !f.path.startsWith(bases) && !p.isArchived(f.path));
    if (this.inType) files = files.filter((f) => p.typesOfFile(f).includes(this.inType));
    p._qoCand = { at: Date.now(), inType: this.inType, files };
    return files.slice();
  }

  search(q) {
    const files = this.candidates();
    if (!q) {
      return files.filter((f) => !this.plugin.isFolderNote(f)).sort((a, b) => b.stat.mtime - a.stat.mtime).slice(0, 30)
        .map((f) => ({ file: f, group: groupLabel(f.stat.mtime) }));
    }
    const fuzzy = prepareFuzzySearch(q);
    const out = [];
    for (const f of files) {
      let m = fuzzy(f.basename);
      if (!m && !this.titleOnly) {
        const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
        const extra = [f.path, ...(fm?.aliases ? [].concat(fm.aliases) : []), ...(fm?.tags ? [].concat(fm.tags) : [])].join(" ");
        m = fuzzy(extra);
        if (m) m = { ...m, score: m.score - 1 };
      }
      if (m) {
        const name = f.basename.toLowerCase(), ql = q.toLowerCase();
        const bonus = name === ql ? 100 : name.startsWith(ql) ? 60 : name.includes(ql) ? 40 : 0;
        out.push({ file: f, score: m.score + bonus });
      }
    }
    return out.sort((a, b) => b.score - a.score || b.file.stat.mtime - a.file.stat.mtime).slice(0, 60);
  }

  crumb(f) {
    const p = this.plugin;
    const tk = p.typeOfFile(f);
    const parts = (f.parent?.path || "").split("/").filter(Boolean);
    const lead = tk ? p.labelFor(tk) : parts[0];
    const last = parts[parts.length - 1];
    if (!lead) return "";
    if (!last || last === lead) return lead;
    return parts.length > 2 ? `${lead} / … / ${last}` : `${lead} / ${last}`;
  }

  iconInto(el, f) {
    const p = this.plugin;
    const iz = p.iconizeInfo(f.path);
    if (iz && p.drawIconize(el, iz)) return;
    const own = p.settings.noteIcons?.[f.path];
    if (own) return paintIcon(el, own.icon, own.color || NO_COLOR);
    const fn = p.folderOfFolderNote(f);
    if (fn) return setIcon(el, "folder");
    setIcon(el, f.extension === "base" ? "table" : f.extension === "canvas" ? "layout-dashboard" : "file-text");
  }

  onOpen() {
    const p = this.plugin;
    p._qoOpen = true;
    this.modalEl.addClass("ot-qo");
    this.containerEl.addClass("ot-qo-container");
    const el = this.contentEl;

    const top = el.createDiv("ot-qo-top");
    setIcon(top.createSpan("ot-qo-search-icon"), "search");
    this.input = top.createEl("input", { type: "text", placeholder: this.leaf ? "Open in new tab…" : "Search pages…" });
    const pv = top.createDiv("clickable-icon ot-qo-toggle");
    setIcon(pv, "panel-right");
    pv.setAttr("aria-label", "Toggle preview");
    pv.onclick = () => { this.showPreview = !this.showPreview; this.modalEl.toggleClass("no-preview", !this.showPreview); this.renderPreview(); };
    this.modalEl.toggleClass("no-preview", !this.showPreview);

    const filters = el.createDiv("ot-qo-filters");
    const titleOnly = filters.createDiv("ot-qo-filter is-on");
    setIcon(titleOnly.createSpan(), "type");
    titleOnly.createSpan({ text: "Title only" });
    titleOnly.onclick = () => { this.titleOnly = !this.titleOnly; titleOnly.toggleClass("is-on", this.titleOnly); this.refresh(); };
    const inF = filters.createDiv("ot-qo-filter");
    const inIcon = inF.createSpan(); setIcon(inIcon, "file");
    const inLabel = inF.createSpan({ text: "In" });
    setIcon(inF.createSpan("ot-qo-caret"), "chevron-down");
    inF.onclick = (e) => {
      const m = new Menu();
      m.addItem((i) => i.setTitle("Anywhere").setChecked(!this.inType).onClick(() => { this.inType = null; inLabel.setText("In"); inF.removeClass("is-on"); setIcon(inIcon, "file"); this.refresh(); }));
      for (const t of p.visibleTypes({ all: true })) {
        m.addItem((i) => i.setTitle(t.label).setChecked(this.inType === t.key).onClick(() => {
          this.inType = t.key; inLabel.setText(t.label); inF.addClass("is-on"); setIcon(inIcon, p.iconFor(t.key)); this.refresh();
        }));
      }
      m.showAtMouseEvent(e);
    };

    const body = el.createDiv("ot-qo-body");
    this.listEl = body.createDiv("ot-qo-list");
    this.previewEl = body.createDiv("ot-qo-preview");

    const foot = el.createDiv("ot-qo-foot");
    const hint = (k, t) => { const h = foot.createDiv("ot-qo-hint"); h.createSpan({ cls: "ot-qo-key", text: k }); h.createSpan({ text: t }); };
    hint("↵", this.leaf ? "Open here" : "Open");
    hint("⌘↵", "Open in new tab");
    hint("⌘L", "Copy link");
    hint("esc", "Close");

    this.input.oninput = () => { this.sel = 0; this.refresh(); };
    this.input.onkeydown = (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); this.move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); this.move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); this.choose(this.sel, e.metaKey || e.ctrlKey); }
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") { e.preventDefault(); this.copyLink(); }
    };
    this.refresh();
    setTimeout(() => this.input.focus(), 0);
  }

  refresh() {
    const q = this.input.value.trim();
    const res = this.search(q);
    // with a query: results first (top hit selected), "New page" last; without: "New page" on top
    this.items = q && res.length ? [...res, { newPage: true }] : [{ newPage: true }, ...res];
    this.sel = Math.min(this.sel, this.items.length - 1);
    const list = this.listEl;
    list.empty();
    let lastGroup = null;
    this.items.forEach((it, i) => {
      if (it.group && it.group !== lastGroup) { list.createDiv({ cls: "ot-qo-group", text: it.group }); lastGroup = it.group; }
      const row = list.createDiv("ot-qo-row");
      row.dataset.i = String(i);
      const ic = row.createSpan("ot-qo-icon");
      if (it.newPage) {
        setIcon(ic, "file-plus");
        row.createSpan({ cls: "ot-qo-title", text: q ? `New page “${q}”` : "New page" });
        row.addClass("is-new");
      } else {
        this.iconInto(ic, it.file);
        row.createSpan({ cls: "ot-qo-title", text: it.file.extension === "md" ? it.file.basename : it.file.name });
        const c = this.crumb(it.file);
        if (c) row.createSpan({ cls: "ot-qo-crumb", text: `— ${c}` });
      }
      row.onmouseenter = () => { this.sel = i; this.markSel(); };
      row.onclick = (e) => this.choose(i, e.metaKey || e.ctrlKey);
    });
    if (!res.length && q) list.createDiv({ cls: "ot-qo-empty", text: "No matching pages" });
    this.markSel();
  }

  move(d) { this.sel = (this.sel + d + this.items.length) % this.items.length; this.markSel(true); }

  markSel(scroll) {
    this.listEl.querySelectorAll(".ot-qo-row").forEach((r) => r.toggleClass("is-selected", Number(r.dataset.i) === this.sel));
    if (scroll) this.listEl.querySelector(".ot-qo-row.is-selected")?.scrollIntoView({ block: "nearest" });
    cancelAnimationFrame(this._pvRaf);
    this._pvRaf = requestAnimationFrame(() => this.renderPreview());
  }

  async renderPreview() {
    const pe = this.previewEl;
    if (!this.showPreview) { pe.empty(); return; }
    const it = this.items[this.sel];
    const token = (this._pv = {});
    pe.empty();
    const card = pe.createDiv("ot-qo-card");
    const p = this.plugin;
    if (!it || it.newPage) {
      setIcon(card.createDiv("ot-qo-card-icon"), "file-plus");
      card.createDiv({ cls: "ot-qo-card-title", text: "Create a new page" });
      card.createDiv({ cls: "ot-qo-card-sub", text: this.inType ? `New ${p.labelFor(this.inType)}` : "Pick a type on the next step" });
      return;
    }
    const f = it.file;
    const thumb = p.thumbnailFor(f, true);
    if (thumb) card.createDiv("ot-qo-card-cover").createEl("img", { attr: { src: thumb } });
    this.iconInto(card.createDiv("ot-qo-card-icon"), f);
    const chips = card.createDiv("ot-qo-card-chips");
    for (const tk of p.typesOfFile(f)) {
      const ch = chips.createSpan("ot-home-mini-chip");
      ch.style.setProperty("--ot-color", p.colorFor(tk));
      setIcon(ch.createSpan(), p.iconFor(tk));
      ch.createSpan({ text: p.labelFor(tk) });
    }
    card.createDiv({ cls: "ot-qo-card-path", text: f.parent?.path === "/" ? "" : f.parent?.path });
    card.createDiv({ cls: "ot-qo-card-title", text: f.extension === "md" ? f.basename : f.name });
    const sn = card.createDiv({ cls: "ot-qo-card-snippet" });
    card.createDiv({ cls: "ot-qo-card-meta", text: `Edited ${moment(f.stat.mtime).fromNow()}` });
    if (f.extension !== "md") return;
    const txt = await this.app.vault.cachedRead(f);
    if (this._pv !== token) return;
    const body = txt.replace(/^---[\s\S]*?\n---\n?/, "").replace(/!?\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, "$1")
      .replace(/[#>*_`~]/g, "").replace(/\n{2,}/g, "\n").trim();
    sn.setText(body.slice(0, 420) || "Empty page");
  }

  async choose(i, newTab) {
    const it = this.items[i];
    if (!it) return;
    this.close();
    if (it.newPage) {
      const q = this.input.value.trim();
      if (this.inType) { const f = await this.plugin.createObject(this.inType); if (q) await this.app.fileManager.renameFile(f, normalizePath(`${f.parent.path}/${q}.md`)); return; }
      new TypePickerModal(this.plugin, async (key) => {
        const f = await this.plugin.createObject(key);
        if (q) await this.app.fileManager.renameFile(f, normalizePath(`${f.parent.path}/${q}.md`));
      }).open();
      return;
    }
    const leaf = newTab ? this.app.workspace.getLeaf("tab") : (this.leaf && this.leaf.view?.getViewType?.() === "empty" ? this.leaf : this.app.workspace.getLeaf(false));
    await leaf.openFile(it.file);
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  onClose() { this.plugin._qoOpen = false; this.contentEl.empty(); }

  async copyLink() {
    const it = this.items[this.sel];
    if (!it?.file) return;
    const link = this.app.fileManager.generateMarkdownLink(it.file, "");
    try { await navigator.clipboard.writeText(link); new Notice(`Copied ${link}`); } catch (e) {}
  }

}

class IconColorModal extends Modal {
  /** opts: { title, icon, color, onSave(icon, color), onRemove? } */
  constructor(plugin, opts) { super(plugin.app); this.plugin = plugin; this.opts = opts; }
  onOpen() {
    const o = this.opts, d = { icon: o.icon || "box", color: o.color || NO_COLOR };
    this.modalEl.addClass("ot-modal", "ot-config-modal");
    this.titleEl.setText(o.title);
    const el = this.contentEl;
    const pIcon = el.createDiv("ot-config-preview").createSpan();
    el.createDiv({ cls: "ot-config-label", text: "Color" });
    const sw = el.createDiv("ot-swatches");
    const swatch = (hex, label, cls = "") => {
      const s0 = sw.createDiv("ot-swatch " + cls);
      s0.dataset.hex = hex; s0.setAttr("aria-label", label);
      if (!cls) s0.style.setProperty("--ot-color", hex);
      s0.onclick = () => { d.color = hex; refresh(); };
    };
    swatch(NO_COLOR, "No color", "ot-swatch-none");
    COLORS.forEach((c) => swatch(c.hex, c.name));
    el.createDiv({ cls: "ot-config-label", text: "Icon" });
    const search = el.createEl("input", { cls: "ot-modal-input", type: "text", placeholder: "Search all icons…" });
    const grid = el.createDiv("ot-icon-grid");
    const refresh = () => {
      paintIcon(pIcon, d.icon, d.color);
      sw.querySelectorAll(".ot-swatch").forEach((s0) => s0.toggleClass("is-selected", s0.dataset.hex === d.color));
      grid.querySelectorAll(".ot-icon-cell").forEach((c) => c.toggleClass("is-selected", c.dataset.icon === d.icon));
      grid.style.setProperty("--ot-color", d.color);
    };
    const draw = () => {
      grid.empty();
      const q = search.value.trim().toLowerCase();
      for (const id of q ? searchIcons(q) : SUGGESTED_ICONS) {
        const cell = grid.createDiv("ot-icon-cell");
        cell.dataset.icon = id; cell.setAttr("aria-label", id);
        setIcon(cell, id);
        if (!cell.firstChild) { cell.remove(); continue; }
        cell.onclick = () => { d.icon = id; refresh(); };
      }
      refresh();
    };
    search.oninput = draw;
    draw();
    const b = el.createDiv("ot-config-buttons");
    if (o.onRemove) { const rm = b.createEl("button", { text: "Reset" }); rm.onclick = async () => { await o.onRemove(); this.close(); }; }
    b.createDiv("ot-spacer");
    const ok = b.createEl("button", { cls: "mod-cta", text: "Done" });
    ok.onclick = async () => { await o.onSave(d.icon, d.color); this.close(); };
  }
  onClose() { this.contentEl.empty(); }
}

class NoteIconModal extends Modal {
  constructor(plugin, file) { super(plugin.app); this.plugin = plugin; this.file = file; }
  onOpen() {
    const p = this.plugin, f = this.file;
    const cur = p.noteIcon(f);
    const d = {
      icon: (cur?.iconize && (TypefoldPlugin.iconizeToLucide(cur.iconize.name) || cur.iconize.name)) || cur?.own?.icon || "file-text",
      color: cur?.iconize?.color || cur?.own?.color || NO_COLOR,
    };
    this.modalEl.addClass("ot-modal", "ot-config-modal");
    this.titleEl.setText(`Icon for “${f.basename}”`);
    const el = this.contentEl;
    const preview = el.createDiv("ot-config-preview");
    const pIcon = preview.createSpan();
    preview.createSpan({ cls: "ot-config-preview-label", text: f.basename });


    el.createDiv({ cls: "ot-config-label", text: "Color" });
    const sw = el.createDiv("ot-swatches");
    const swatch = (hex, label, cls = "") => {
      const s0 = sw.createDiv("ot-swatch " + cls);
      s0.dataset.hex = hex; s0.setAttr("aria-label", label);
      if (!cls) s0.style.setProperty("--ot-color", hex);
      s0.onclick = () => { d.color = hex; refresh(); };
    };
    swatch(NO_COLOR, "No color", "ot-swatch-none");
    COLORS.forEach((c) => swatch(c.hex, c.name));

    el.createDiv({ cls: "ot-config-label", text: "Icon" });
    const search = el.createEl("input", { cls: "ot-modal-input", type: "text", placeholder: "Search all icons…" });
    const grid = el.createDiv("ot-icon-grid");
    const all = (getIconIds?.() || []).map((id) => id.replace(/^lucide-/, "")).filter((id, i, a) => a.indexOf(id) === i);
    const refresh = () => {
      paintIcon(pIcon, d.icon, d.color);
      sw.querySelectorAll(".ot-swatch").forEach((s0) => s0.toggleClass("is-selected", s0.dataset.hex === d.color));
      grid.querySelectorAll(".ot-icon-cell").forEach((c) => c.toggleClass("is-selected", c.dataset.icon === d.icon));
      grid.style.setProperty("--ot-color", d.color);
    };
    const draw = () => {
      grid.empty();
      const q = search.value.trim().toLowerCase();
      for (const id of q ? searchIcons(q) : SUGGESTED_ICONS) {
        const cell = grid.createDiv("ot-icon-cell");
        cell.dataset.icon = id; cell.setAttr("aria-label", id);
        setIcon(cell, id);
        if (!cell.firstChild) { cell.remove(); continue; }
        cell.onclick = () => { d.icon = id; refresh(); };
      }
      refresh();
    };
    search.oninput = draw;
    draw();

    const b = el.createDiv("ot-config-buttons");
    if (cur) {
      const rm = b.createEl("button", { text: "Remove icon" });
      rm.onclick = async () => { await p.setNoteIcon(f, null); this.close(); };
    }
    b.createDiv("ot-spacer");
    const ok = b.createEl("button", { cls: "mod-cta", text: "Done" });
    ok.onclick = async () => { await p.setNoteIcon(f, d.icon, d.color); this.close(); };
  }
  onClose() { this.contentEl.empty(); }
}

class DeleteTypeModal extends Modal {
  constructor(plugin, key) { super(plugin.app); this.plugin = plugin; this.key = key; }
  onOpen() {
    const p = this.plugin, key = this.key, label = p.labelFor(key);
    this.modalEl.addClass("ot-modal");
    this.titleEl.setText(`Delete type “${label}”?`);
    const el = this.contentEl;
    const n = p.index.get(key)?.files.length || 0;
    const withProp = p.app.vault.getMarkdownFiles().filter((f) =>
      typeValues(p.app.metadataCache.getFileCache(f)?.frontmatter?.[p.prop]).some((v) => v.toLowerCase() === key)).length;
    const page = p.app.vault.getAbstractFileByPath(p.typeNotePath(key)) || p.app.vault.getAbstractFileByPath(p.basePath(key, null));
    el.createEl("p", { text: `The “${label}” tag will disappear from ${n} notes. No notes or folders are deleted or moved.` });
    const opts = { removeProperty: withProp > 0, removePage: !!page };
    const check = (text, k, show) => {
      if (!show) { opts[k] = false; return; }
      const row = el.createEl("label", { cls: "ot-check" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = opts[k];
      cb.onchange = () => { opts[k] = cb.checked; };
      row.createSpan({ text });
    };
    check(`Also remove “${p.prop}: ${label}” from ${withProp} notes`, "removeProperty", withProp > 0);
    check(`Move its page (${page?.basename}) to the trash`, "removePage", !!page);
    const buttons = el.createDiv("ot-config-buttons");
    buttons.createDiv("ot-spacer");
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const del = buttons.createEl("button", { cls: "mod-warning", text: "Delete type" });
    del.onclick = async () => {
      del.disabled = true; del.setText("Deleting…");
      const { changed } = await p.deleteType(key, opts);
      new Notice(`Deleted type “${label}”${changed ? ` and removed it from ${changed} notes` : ""}.`);
      this.close();
    };
  }
  onClose() { this.contentEl.empty(); }
}

class NoteSuggest extends AbstractInputSuggest {
  constructor(app, inputEl) { super(app, inputEl); this.inputEl = inputEl; }
  getSuggestions(q) {
    const ql = q.toLowerCase();
    return this.app.vault.getFiles().filter((f) => ["md", "canvas", "base"].includes(f.extension) && f.path.toLowerCase().includes(ql))
      .sort((a, b) => a.path.length - b.path.length).slice(0, 50);
  }
  renderSuggestion(f, el) { el.setText(f.path); }
  selectSuggestion(f) { this.inputEl.value = f.path; this.inputEl.dispatchEvent(new Event("input")); this.close(); }
}

class FolderSuggest extends AbstractInputSuggest {
  constructor(app, inputEl) { super(app, inputEl); this.inputEl = inputEl; }
  getSuggestions(q) {
    const ql = q.toLowerCase();
    const all = this.app.vault.getAllLoadedFiles().filter((f) => f instanceof TFolder && f.path !== "/" && !f.path.startsWith("."));
    return all.filter((f) => f.path.toLowerCase().includes(ql)).slice(0, 50);
  }
  renderSuggestion(f, el) { el.setText(f.path); }
  selectSuggestion(f) { this.inputEl.value = f.path; this.inputEl.dispatchEvent(new Event("input")); this.close(); }
}

/* ───────── one dialog for making and editing a type (and a folder's icon): Basics · Properties · New notes · Pages ───────── */
class TypeModal extends Modal {
  /** opts: { mode: "create" | "edit" | "folder", key?, preset? } */
  constructor(plugin, opts, onDone) { super(plugin.app); this.plugin = plugin; this.opts = opts; this.onDone = onDone; this.curTab = "basics"; }
  onOpen() {
    const p = this.plugin, { mode } = this.opts;
    const key = this.opts.key;
    const c = key ? p.conf(key) : {};
    const preset = this.opts.preset || {};
    const fkey = key ? p.parseFolderKey(key) : null;
    const izNow = fkey && !c.icon ? p.iconizeInfo(fkey.path) : null;
    // everything the dialog edits lives in `d` until Save / Create
    const d = this.d = mode === "create" ? {
      label: preset.label || "", folders: [preset.folder || ""], icon: "box", color: COLORS[6].hex,
      folderProps: [], defaultProps: [], matchProperty: false, template: "", newIn: "here", onHome: true,
      pages: p.settings.openBaseOnClick !== false ? "root" : "none",
    } : {
      label: c.label || "", folders: mode === "edit" ? (p.typeFolders(key).length ? p.typeFolders(key) : [""]) : [],
      icon: (izNow && (TypefoldPlugin.iconizeToLucide(izNow.name) || izNow.name)) || p.iconFor(key),
      color: izNow?.color || p.colorFor(key),
      folderProps: (c.folderProps || []).map((x) => (typeof x === "string" ? { name: x } : x ? { ...x } : {})),
      defaultProps: Object.entries(c.defaultProps || {}).map(([k, v]) => ({ k, v: Array.isArray(v) ? v.join(", ") : String(v), t: p.inferPropType(k) })),
      matchProperty: !!c.matchProperty, template: c.template || "", newIn: c.newIn || "here", onHome: !c.hideOnHome,
      pages: c.noPage ? "none" : c.folderNotes === "all" ? "all" : "root",
    };
    if (mode === "create" && d.label) for (const [re, ic] of ICON_GUESS) if (re.test(d.label.toLowerCase())) { d.icon = ic; break; }
    this.startPages = d.pages;

    this.modalEl.addClass("ot-modal", "ot-config-modal", "ot-type-modal");
    this.titleEl.setText(mode === "create" ? "New object type" : mode === "folder" ? "Folder icon & color" : "Edit object type");
    const el = this.contentEl;

    // header: live preview + name
    const head = el.createDiv("ot-tm-head");
    this.pIcon = head.createSpan();
    if (mode === "folder") head.createSpan({ cls: "ot-config-preview-label", text: p.labelFor(key) });
    else {
      const nameIn = head.createEl("input", { cls: "ot-modal-input ot-type-name ot-tm-name", type: "text",
        placeholder: mode === "create" ? "Type name, e.g. People, Books, Projects" : p.index.get(key)?.label || key });
      nameIn.value = d.label;
      nameIn.oninput = () => { d.label = nameIn.value.trim(); this.refresh(); };
      this.nameIn = nameIn;
    }

    // tabs
    const TABS = mode === "folder" ? [] : [["basics", "Basics", "folder"], ["look", "Icon & color", "palette"], ["props", "Properties", "list"]];
    if (TABS.length) {
      const tabs = el.createDiv("ot-tm-tabs");
      this.curTabEls = {};
      for (const [id, label, icon] of TABS) {
        const b = tabs.createDiv("ot-tm-tab");
        setIcon(b.createSpan("ot-tm-tab-icon"), icon);
        b.createSpan({ text: label });
        b.onclick = () => { this.curTab = id; this.drawTab(); };
        this.curTabEls[id] = b;
      }
    }
    this.body = el.createDiv("ot-tm-body" + (mode === "folder" ? " is-folder" : ""));

    // footer
    const foot = el.createDiv("ot-config-buttons ot-tm-foot");
    if (mode !== "create") {
      const reset = foot.createEl("button", { text: "Reset icon" });
      reset.onclick = () => { delete c.icon; delete c.color; d.icon = p.iconFor(key); d.color = p.colorFor(key); this.drawTab(); };
    }
    foot.createDiv("ot-spacer");
    foot.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    this.saveBtn = foot.createEl("button", { cls: "mod-cta", text: mode === "create" ? "Create type" : "Save" });
    this.saveBtn.onclick = () => this.save();

    this.drawTab();
    if (this.nameIn && mode === "create") setTimeout(() => this.nameIn.focus(), 0);
  }

  refresh() {
    const d = this.d;
    paintIcon(this.pIcon, d.icon, d.color);
    this.pIcon.addClass("ot-tm-icon");
    if (this.opts.mode === "create") this.saveBtn.disabled = !d.label || !d.folders.some((x) => x && x.trim());
    for (const [id, b] of Object.entries(this.curTabEls || {})) b.toggleClass("is-active", id === this.curTab);
  }

  drawTab() {
    const b = this.body;
    b.empty();
    if (this.opts.mode === "folder" || this.curTab === "look") this.drawLook(b);
    else if (this.curTab === "basics") this.drawBasics(b);
    else this.drawProps(b);
    this.refresh();
  }

  section(b, title, desc) {
    const s = b.createDiv("ot-tm-section");
    s.createDiv({ cls: "ot-config-label", text: title });
    if (desc) s.createDiv({ cls: "ot-tm-desc", text: desc });
    return s;
  }

  /* Basics: folder (right under the name), then icon & colour */
  drawBasics(b) {
    const p = this.plugin, d = this.d, mode = this.opts.mode;
    if (mode !== "folder") {
      const s = this.section(b, "Folders", "Everything inside belongs to this type, subfolders included. Add more than one folder if the notes live in several places. Nothing is written to the notes.");
      const list = s.createDiv("ot-tm-folders");
      const draw = () => {
        list.empty();
        d.folders.forEach((f, i) => {
          const row = list.createDiv("ot-tm-folder-row");
          const inp = row.createEl("input", { cls: "ot-modal-input", type: "text", placeholder: "Pick or type a folder (created if it doesn't exist)" });
          inp.value = f;
          new FolderSuggest(this.app, inp);
          const info = row.createDiv("ot-tm-folder-info");
          const upd = () => {
            d.folders[i] = inp.value.trim().replace(/\/$/, "");
            const path = d.folders[i];
            const exists = path && this.app.vault.getAbstractFileByPath(normalizePath(path));
            const n = exists ? this.app.vault.getMarkdownFiles().filter((x) => x.path.startsWith(normalizePath(path) + "/")).length : 0;
            info.setText(!path ? "" : exists ? `${n} notes` : "will be created");
            this.refresh();
          };
          inp.oninput = upd;
          upd();
          if (d.folders.length > 1) {
            const x = row.createDiv("clickable-icon");
            setIcon(x, "x");
            x.setAttr("aria-label", "Remove folder");
            x.onclick = () => { d.folders.splice(i, 1); draw(); };
          }
        });
        {
          const add = list.createDiv("ot-tm-add");
          setIcon(add.createSpan(), "plus");
          add.createSpan({ text: "Add another folder" });
          add.onclick = () => { d.folders.push(""); draw(); [...list.querySelectorAll("input")].pop()?.focus(); };
        }
      };
      draw();
      this.drawPages(b);
      this.drawWhere(b);
      const s3 = this.section(b, "Notes outside the folder");
      new Setting(s3).setName(`Also include notes whose “${p.prop}” is this type`)
        .setDesc("Lets a note elsewhere in the vault belong to this type through its frontmatter.")
        .addToggle((t) => t.setValue(d.matchProperty).onChange((v) => { d.matchProperty = v; }));
      const s4 = this.section(b, "Home");
      new Setting(s4).setName("Show on Home").setDesc("A card for this type on the Home dashboard.")
        .addToggle((t) => t.setValue(d.onHome).onChange((v) => { d.onHome = v; }));
    }
  }

  /* Icon & color (the only tab for a subfolder) */
  drawLook(b) {
    const d = this.d;
    const cs = this.section(b, "Color");
    const sw = cs.createDiv("ot-swatches");
    const mark = () => sw.querySelectorAll(".ot-swatch").forEach((s) => s.toggleClass("is-selected", s.dataset.hex === d.color));
    { const s0 = sw.createDiv("ot-swatch ot-swatch-none"); s0.dataset.hex = NO_COLOR; s0.setAttr("aria-label", "No color"); s0.onclick = () => { d.color = NO_COLOR; mark(); grid.style.setProperty("--ot-color", d.color); this.refresh(); }; }
    for (const col of COLORS) {
      const s = sw.createDiv("ot-swatch");
      s.dataset.hex = col.hex;
      s.style.setProperty("--ot-color", col.hex);
      s.setAttr("aria-label", col.name);
      s.onclick = () => { d.color = col.hex; mark(); grid.style.setProperty("--ot-color", d.color); this.refresh(); };
    }
    mark();
    const is = this.section(b, "Icon");
    const search = is.createEl("input", { cls: "ot-modal-input", type: "text", placeholder: "Search all icons…" });
    const grid = is.createDiv("ot-icon-grid");
    grid.style.setProperty("--ot-color", d.color);
    const drawIcons = () => {
      grid.empty();
      const q = search.value.trim().toLowerCase();
      const ids = q ? searchIcons(q) : SUGGESTED_ICONS;
      if (!ids.length) grid.createDiv({ cls: "ot-empty", text: "No icons found" });
      for (const id of ids) {
        const cell = grid.createDiv("ot-icon-cell" + (id === d.icon ? " is-selected" : ""));
        cell.dataset.icon = id;
        cell.setAttr("aria-label", id);
        setIcon(cell, id);
        if (!cell.firstChild) { cell.remove(); continue; }
        cell.onclick = () => { d.icon = id; grid.querySelectorAll(".ot-icon-cell").forEach((x) => x.toggleClass("is-selected", x.dataset.icon === id)); this.refresh(); };
      }
    };
    search.oninput = drawIcons;
    drawIcons();
  }

  /* Properties: from folder levels, fixed ones for new notes, and matching by the type property */
  drawProps(b) {
    const p = this.plugin, d = this.d;
    const folders = d.folders.filter(Boolean).map((f) => normalizePath(f));
    const has = (k) => d.defaultProps.some((r) => r.k === k);
    const ownBox = { el: null };

    // 1 · properties the notes in these folders already share
    const s1 = this.section(b, "1 · Common properties in this folder",
      "Properties the notes here already use, most used first. Tick the ones every new note should start with.");
    const files = this.app.vault.getMarkdownFiles().filter((f) => folders.some((dir) => f.path.startsWith(dir + "/")) && !p.isFolderNote(f) && !p.isTemplate(f)).slice(0, 3000);
    const counts = new Map();
    const skip = new Set(["position", "cssclasses", p.prop]);
    const fromFolders = new Set(d.folderProps.map((x) => x?.name).filter(Boolean));
    for (const f of files) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter || {};
      for (const [k, v] of Object.entries(fm)) {
        if (skip.has(k)) continue;
        const e = counts.get(k) || { n: 0, vals: new Map() };
        e.n++;
        if (v != null && typeof v !== "object" && String(v).trim() && String(v).length <= 40) e.vals.set(String(v), (e.vals.get(String(v)) || 0) + 1);
        counts.set(k, e);
      }
    }
    // most used first (ties by name)
    const common = [...counts.entries()].filter(([, e]) => e.n >= 2).sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).slice(0, 20);
    if (!folders.length) s1.createDiv({ cls: "ot-tm-desc", text: "Pick a folder in Basics first." });
    else if (!common.length) s1.createDiv({ cls: "ot-tm-desc", text: files.length ? "These notes don't share any properties yet." : "No notes in this folder yet." });
    const list = s1.createDiv("ot-tm-common");
    for (const [k, e] of common) {
      const top = [...e.vals.entries()].sort((a, b) => b[1] - a[1])[0];
      const row = list.createEl("label", { cls: "ot-tm-common-row" });
      row.style.setProperty("--ot-share", `${Math.round((e.n / Math.max(1, files.length)) * 100)}%`);
      const cb = row.createEl("input", { type: "checkbox" });
      const auto = fromFolders.has(k);
      cb.checked = auto || has(k);
      cb.disabled = auto;
      row.createSpan({ cls: "ot-tm-common-name", text: k });
      if (auto) row.createSpan({ cls: "ot-tm-common-badge", text: "from folders" });
      row.createSpan({ cls: "ot-tm-common-n", text: `${e.n} of ${files.length} notes${top ? ` · e.g. ${top[0]}` : ""}` });
      if (auto) { row.addClass("is-auto"); continue; }
      cb.onchange = () => {
        if (cb.checked && !has(k)) d.defaultProps.push({ k, v: top && top[1] / e.n >= 0.6 ? top[0] : "", t: p.inferPropType(k) });
        if (!cb.checked) d.defaultProps = d.defaultProps.filter((r) => r.k !== k);
        drawOwn();
      };
    }

    // 2 · one property per folder level
    const root = folders[0] && this.app.vault.getAbstractFileByPath(folders[0]);
    const levels = [];
    if (root instanceof TFolder) {
      const walk = (fo, depth) => {
        if (depth > 4) return;
        for (const c of fo.children) if (c instanceof TFolder && !c.name.startsWith(".")) {
          (levels[depth - 1] ||= new Set()).add(c.name);
          walk(c, depth + 1);
        }
      };
      walk(root, 1);
    }
    const s2 = this.section(b, "2 · From the folder structure",
      "Name a property for each folder level below the type's folder. New notes get it filled in from the folder they're made in.");
    const lv = s2.createDiv("ot-tm-levels");
    const nLevels = Math.max(levels.length, d.folderProps.length, 1);
    for (let i = 0; i < Math.min(nLevels, 5); i++) {
      const row = lv.createDiv("ot-tm-level");
      row.createDiv({ cls: "ot-tm-level-n", text: `Level ${i + 1}` });
      const ex = [...(levels[i] || [])].slice(0, 3);
      row.createDiv({ cls: "ot-tm-level-ex", text: ex.length ? ex.join(", ") + (levels[i].size > 3 ? "…" : "") : "no folders yet" });
      const inp = row.createEl("input", { cls: "ot-modal-input", type: "text", placeholder: i === 0 ? "e.g. semester" : i === 1 ? "e.g. course" : "property name" });
      inp.value = d.folderProps[i]?.name || "";
      inp.oninput = () => { d.folderProps[i] = { ...(d.folderProps[i] || {}), name: inp.value.trim() }; };
    }

    // 3 · your own properties
    const s3 = this.section(b, "3 · Your own", "Added to every new note of this type. {{date}} becomes today's date. A property's type is shared by the whole vault, as in Obsidian.");
    ownBox.el = s3.createDiv("ot-tm-props");
    const drawOwn = () => {
      const rows = ownBox.el;
      rows.empty();
      const TYPES = [["text", "Text"], ["multitext", "List"], ["number", "Number"], ["checkbox", "Checkbox"], ["date", "Date"], ["datetime", "Date & time"]];
      d.defaultProps.forEach((r, i) => {
        r.t ||= p.inferPropType(r.k);
        const row = rows.createDiv("ot-tm-prop");
        const k = row.createEl("input", { cls: "ot-modal-input", type: "text", placeholder: "name" });
        k.value = r.k;
        k.oninput = () => { r.k = k.value.trim(); };
        // until you pick a type yourself, it follows what existing notes use for this name (text if none)
        k.onchange = () => { if (!r.manual) { const t = p.inferPropType(r.k); if (t !== r.t) { r.t = t; drawOwn(); } } };
        const sel = row.createEl("select", { cls: "dropdown ot-tm-prop-type" });
        for (const [val, label] of TYPES) sel.createEl("option", { value: val, text: label });
        if (![...sel.options].some((o) => o.value === r.t)) sel.createEl("option", { value: r.t, text: r.t });
        sel.value = r.t;
        sel.onchange = () => { r.t = sel.value; r.manual = true; if (r.t === "checkbox" && !["true", "false"].includes(r.v)) r.v = "false"; drawOwn(); };
        const vwrap = row.createDiv("ot-tm-prop-val");
        if (r.t === "checkbox") {
          const cb = vwrap.createEl("input", { type: "checkbox" });
          cb.checked = r.v === "true";
          cb.onchange = () => { r.v = cb.checked ? "true" : "false"; };
          vwrap.createSpan({ cls: "ot-tm-desc", text: "checked in new notes" });
        } else {
          const ph = { multitext: "item, item…", number: "0", date: "YYYY-MM-DD or {{date}}", datetime: "YYYY-MM-DDTHH:mm or {{date}}" }[r.t] || "value (optional)";
          const v = vwrap.createEl("input", { cls: "ot-modal-input", type: r.t === "number" ? "number" : "text", placeholder: ph });
          v.value = r.v;
          v.oninput = () => { r.v = v.value; };
        }
        const x = row.createDiv("clickable-icon");
        setIcon(x, "x");
        x.setAttr("aria-label", "Remove");
        x.onclick = () => {
          d.defaultProps.splice(i, 1);
          list.querySelectorAll(".ot-tm-common-row").forEach((cr) => { if (cr.querySelector(".ot-tm-common-name").textContent === r.k) cr.querySelector("input").checked = false; });
          drawOwn();
        };
      });
      const add = rows.createDiv("ot-tm-add");
      setIcon(add.createSpan(), "plus");
      add.createSpan({ text: "Add property" });
      add.onclick = () => { d.defaultProps.push({ k: "", v: "", t: "text" }); drawOwn(); [...rows.querySelectorAll(".ot-tm-prop")].pop()?.querySelector("input")?.focus(); };
    };
    drawOwn();

    // 4 · template
    const s4 = this.section(b, "4 · Template", "New notes start as a copy of this note — its text and its properties. Leave empty for a blank note.");
    const tin = s4.createEl("input", { cls: "ot-modal-input", type: "text", placeholder: "No template — pick a note" });
    tin.value = d.template;
    new NoteSuggest(this.app, tin);
    const info = s4.createDiv("ot-tm-desc");
    const upd = () => {
      d.template = tin.value.trim();
      const f = d.template && this.app.vault.getAbstractFileByPath(normalizePath(d.template));
      if (!d.template) info.setText("");
      else if (!f) info.setText("Note not found.");
      else {
        const fm = Object.keys(this.app.metadataCache.getFileCache(f)?.frontmatter || {}).filter((k) => k !== "position");
        info.setText(fm.length ? `Copies its text and these properties: ${fm.join(", ")}. {{title}}, {{date}} and {{time}} are filled in.` : "Copies its text. {{title}}, {{date}} and {{time}} are filled in.");
      }
    };
    tin.oninput = upd;
    upd();
  }

  /* where new notes are saved */
  drawWhere(b) {
    const d = this.d;
    const s2 = this.section(b, "Where new notes go");
    const seg = s2.createDiv("ot-tasks-seg");
    const hint = s2.createDiv("ot-tm-desc");
    const drawSeg = () => {
      seg.empty();
      for (const [v, t] of [["here", "The folder you're in"], ["root", "Always the type's folder"]]) {
        const bt = seg.createDiv({ cls: "ot-tasks-seg-btn" + (d.newIn === v ? " is-active" : ""), text: t });
        bt.onclick = () => { d.newIn = v; drawSeg(); };
      }
      hint.setText(d.newIn === "here" ? "Making a note while a subfolder is selected puts it in that subfolder (and fills its folder properties)."
        : `Always in ${d.folders[0] || "the type's folder"}, whichever subfolder is selected.`);
    };
    drawSeg();
  }

  drawPages(b) {
    const p = this.plugin, d = this.d, mode = this.opts.mode;
    const s = this.section(b, "Pages", "A page is a note with a table (or board) of notes, opened when you click the type or folder.");
    const seg = s.createDiv("ot-tasks-seg");
    const hint = s.createDiv("ot-tm-desc");
    const subOk = p.fnSettings().enabled;
    const HINT = {
      none: "No pages. Clicking the type shows its notes in the sidebar list.",
      root: "One page for this type with all its notes.",
      all: subOk ? "The type's page, plus a board page (folder note) in every subfolder — new subfolders too."
        : "The type's page. Subfolder pages need the Folder notes plugin and “Use folder notes” on.",
    };
    const drawSeg = () => {
      seg.empty();
      for (const [v, t] of [["none", "Don't create"], ["root", "This folder"], ["all", "Folder + subfolders"]]) {
        const bt = seg.createDiv({ cls: "ot-tasks-seg-btn" + (d.pages === v ? " is-active" : ""), text: t });
        bt.onclick = () => { d.pages = v; drawSeg(); };
      }
      hint.setText(HINT[d.pages] + (mode === "edit" && d.pages !== this.startPages ? "  Pages that already exist are kept." : ""));
    };
    drawSeg();
    if (p.settings.openBaseOnClick === false) s.createDiv({ cls: "ot-tm-desc ot-settings-warn", text: "Type pages are turned off in Settings → Sidebar, so none are opened for any type." });
    if (mode === "edit") {
      const page = this.app.vault.getAbstractFileByPath(p.typeNotePath(this.opts.key));
      if (page) {
        const s2 = this.section(b, "Page banner");
        new Setting(s2).setName("Banner image").setDesc("The picture at the top of this type's page.")
          .addButton((bt) => bt.setButtonText("Choose…").onClick(() => new BannerPickerModal(p, page).open()));
      }
    }
  }

  async save() {
    const p = this.plugin, d = this.d, mode = this.opts.mode;
    const props = () => d.folderProps.map((x) => x && x.name ? (x.match ? { name: x.name, match: x.match } : x.name) : null);
    const trimProps = (arr) => { while (arr.length && !arr[arr.length - 1]) arr.pop(); return arr.map((x) => x || null); };
    const defaults = () => {
      const rows = d.defaultProps.filter((r) => r.k);
      for (const r of rows) if (r.manual) p.setPropType(r.k, r.t || "text"); // only types you picked yourself change the vault-wide type
      return Object.fromEntries(rows.map((r) => [r.k, p.coerceProp(r.t || "text", r.v)]));
    };
    this.saveBtn.disabled = true;
    try {
      if (mode === "create") {
        if (!d.label || !d.folders.some((x) => x.trim())) return;
        this.saveBtn.setText("Creating…");
        const folders = [...new Set(d.folders.map((x) => x.trim().replace(/\/$/, "")).filter(Boolean))];
        const { key, changed } = await p.registerType({ label: d.label, icon: d.icon, color: d.color, folder: folders[0], assign: false,
          typePage: d.pages !== "none", folderNote: d.pages === "all" ? "subs" : "none" });
        const c = p.conf(key);
        // the other folders: same type, same folder-note choice
        for (const f of folders.slice(1)) {
          await p.ensureFolder(normalizePath(f));
          if (d.pages === "all") await p.ensureFolderNotesUnder(f, d.label, true);
        }
        c.folders = folders.map((f) => normalizePath(f));
        c.folderProps = trimProps(props());
        c.defaultProps = defaults();
        if (d.matchProperty) c.matchProperty = true;
        if (d.template) c.template = d.template;
        if (d.newIn === "root") c.newIn = "root";
        if (!d.onHome) c.hideOnHome = true;
        await p.saveSettings();
        new Notice(`Created type “${d.label}”${changed ? ` and set it on ${changed} notes` : ""}.`);
        this.close();
        this.onDone?.(key);
        p.activateView().then(() => p.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view?.select(key));
        return;
      }
      const key = this.opts.key;
      const fresh = await p.loadData();
      if (fresh) { p.settings = Object.assign({}, DEFAULT_SETTINGS, fresh); p.settings.types ||= {}; }
      const c = p.conf(key);
      c.icon = d.icon; c.color = d.color;
      if (p.iconizePlugin()) {
        const fk2 = p.parseFolderKey(key);
        const isDefault = d.icon === "folder" && (!d.color || d.color === p.colorFor(fk2?.type || key));
        if (fk2) { await p.writeIconize(fk2.path, isDefault ? null : d.icon, d.color); delete c.icon; if (isDefault) delete c.color; }
        else for (const f of d.folders.filter(Boolean)) await p.writeIconize(f, d.icon, d.color);
      }
      if (mode === "edit") {
        c.folders = d.folders.map((x) => x.trim().replace(/\/$/, "")).filter(Boolean);
        delete c.folder;
        if (d.label) c.label = d.label; else delete c.label;
        c.folderProps = trimProps(props());
        c.defaultProps = defaults();
        if (d.matchProperty) c.matchProperty = true; else delete c.matchProperty;
        if (d.template) c.template = d.template; else delete c.template;
        if (d.newIn === "root") c.newIn = "root"; else delete c.newIn;
        if (d.pages === "none") c.noPage = true; else delete c.noPage;
        if (d.onHome) delete c.hideOnHome; else c.hideOnHome = true;
        c.folderNotes = d.pages === "all" ? "all" : "none";
      }
      await p.saveSettings();
      if (mode === "edit" && d.pages === "all" && this.startPages !== "all") {
        for (const f of c.folders) await p.ensureFolderNotesUnder(f, p.labelFor(key), true);
      }
      this.close();
      this.onDone?.();
    } finally { if (this.saveBtn?.isConnected) { this.saveBtn.disabled = false; } }
  }
  onClose() { this.contentEl.empty(); }
}
class NewTypeModal extends TypeModal {
  constructor(plugin, preset = {}, onDone) { super(plugin, { mode: "create", preset }, onDone); }
}
class TypeConfigModal extends TypeModal {
  constructor(plugin, key, onDone) { super(plugin, { mode: key.includes(":") ? "folder" : "edit", key }, onDone); }
}


/* ───────────────────────────── Settings ───────────────────────────── */

class TypefoldSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; this.tab = "general"; }
  display() {
    const p = this.plugin, root = this.containerEl;
    root.empty();
    root.addClass("ot-settings");
    const s = p.settings;

    // tabs
    const TABS = [["general", "General", "settings"], ["sidebar", "Sidebar", "panel-left"], ["notes", "Notes", "file-text"],
      ["home", "Home", "house"], ["tasks", "Tasks", "circle-check"], ["types", "Types", "shapes"], ["more", "More", "puzzle"]];
    const nav = root.createDiv("ot-settings-tabs");
    for (const [id, label, icon] of TABS) {
      const b = nav.createDiv({ cls: "ot-settings-tab" + (this.tab === id ? " is-active" : "") });
      setIcon(b.createSpan("ot-settings-tab-icon"), icon);
      b.createSpan({ text: label });
      b.onclick = () => { this.tab = id; this.display(); };
    }
    const el = root.createDiv("ot-settings-body");
    const heading = (name, desc) => {
      const h = new Setting(el).setName(name).setHeading();
      if (desc) h.setDesc(desc);
      return h;
    };
    const toggle = (name, desc, k, rebuild = true) => new Setting(el).setName(name).setDesc(desc)
      .addToggle((t) => t.setValue(!!s[k]).onChange(async (v) => { s[k] = v; await p.saveSettings(rebuild); }));

    if (this.tab === "general") {
      const g = el.createDiv("ot-settings-guide");
      g.createDiv({ cls: "ot-settings-guide-text", text: "Don't know where to start? Make several object types at once and choose what Typefold shows." });
      const gb = g.createEl("button", { cls: "mod-cta", text: "Start here" });
      gb.onclick = () => new WhatsNewModal(p, "start").open();
      const gb2 = g.createEl("button", { text: "Guide & what's new" });
      gb2.onclick = () => new WhatsNewModal(p, "new").open();

      heading("Basics");
      new Setting(el).setName("Use as default file explorer")
        .setDesc("Hides the core File explorer tab, opens this panel on startup, and sends “Open file explorer” and “Reveal current file in navigation” here.")
        .addToggle((t) => t.setValue(!!s.replaceExplorer).onChange(async (v) => {
          s.replaceExplorer = v; await p.saveSettings(false);
          if (v) p.activateView();
        }));
      new Setting(el).setName("Type property").setDesc("Frontmatter property that can also put a note into a type (besides its folder).")
        .addText((t) => t.setValue(s.property).onChange(async (v) => { s.property = v.trim() || "type"; await p.saveSettings(); }));
      toggle("Search panel in new tabs", "A new empty tab opens a search panel to pick the page to open (⌘T).", "newTabSearch", false);

      heading("Interface");
      toggle("Ribbon buttons", "Home and Typefold buttons in the left ribbon.", "showRibbon", false);
      toggle("Status bar", "Backlink and property counts in the status bar (click the property count to show or hide properties).", "showStatusBar", false);
      toggle("Capacities look", "Tinted active tab and accent links.", "themeTweaks", false);
      toggle("Show what's new after updates", "Open the guide with the changes the first time Obsidian starts after an update.", "showWhatsNew", false);
    }

    if (this.tab === "sidebar") {
      heading("Shortcuts", "The rows at the top of the sidebar.");
      const shown = () => s.smartItems || SMART.map((x) => x.key);
      for (const sm of SMART) {
        const desc = { "smart:home": "Opens Home.", "smart:inbox": "Notes and documents (PDF, Word, canvas…) outside every object type.",
          "smart:calendar": p.calendarMerged() ? "Daily notes and your tasks, in tabs." : "Daily notes, newest first.",
          "smart:tasks": p.calendarMerged() ? "Shown inside Calendar while the two are combined (see below)." : "Your tasks by day, week, month or list." }[sm.key] || "";
        new Setting(el).setName(sm.label).setDesc(desc).addToggle((t) => t.setValue(s.showSmart && shown().includes(sm.key)).onChange(async (v) => {
          const set = new Set(shown());
          v ? set.add(sm.key) : set.delete(sm.key);
          s.smartItems = SMART.map((x) => x.key).filter((k) => set.has(k));
          if (v) s.showSmart = true;
          await p.saveSettings();
        }));
      }
      new Setting(el).setName("Calendar and Tasks as separate rows")
        .setDesc("Off: one Calendar row with a Daily notes tab next to your task views, and daily notes linked on each day. On: Calendar (daily notes) and Tasks are two rows.")
        .addToggle((t) => t.setValue(!!s.splitCalendarTasks).onChange(async (v) => { s.splitCalendarTasks = v; await p.saveSettings(); this.display(); }));
      toggle("Favorites", "Your bookmarked files and folders (core Bookmarks plugin), as a small foldable section.", "showFavorites");
      toggle("Recents", "Files you opened lately, as a small foldable section.", "showRecents");
      new Setting(el).setName("Recents to show").addSlider((sl) => sl.setLimits(3, 20, 1).setValue(s.recentsCount || 7).setDynamicTooltip()
        .onChange(async (v) => { s.recentsCount = v; await p.saveSettings(); }));

      heading("Sections");
      toggle("Files section", "Images, PDFs, videos, audio and tags.", "showFiles");
      toggle("Counts", "Note counts next to each type.", "showCounts");
      toggle("New & Search buttons", "The buttons at the top of the sidebar.", "showNavTop", false);
      toggle("Footer", "Vault name, settings, light/dark and command palette at the bottom.", "showNavFooter", false);

      heading("Object types list");
      new Setting(el).setName("Minimum notes per type").setDesc("Hide types with fewer notes than this.")
        .addSlider((sl) => sl.setLimits(1, 10, 1).setValue(s.minCount).setDynamicTooltip()
          .onChange(async (v) => { s.minCount = v; await p.saveSettings(); }));
      new Setting(el).setName("Sort types by")
        .addDropdown((d) => d.addOptions({ manual: "Manual (drag in sidebar)", name: "Name", count: "Note count" }).setValue(s.sortTypes)
          .onChange(async (v) => { s.sortTypes = v; await p.saveSettings(); }));
      new Setting(el).setName("Iconize icons")
        .setDesc("Use & sync: show Iconize's folder/file icons here and write icon changes made here back to Iconize. Ignore: use only this plugin's icons.")
        .addDropdown((d) => d.addOptions({ sync: "Use & sync", ignore: "Ignore" }).setValue(s.iconize || "sync")
          .onChange(async (v) => { s.iconize = v; await p.saveSettings(); }));

      heading("Behaviour");
      toggle("Follow the open note", "When you open a note from anywhere (breadcrumbs, links, search), select its folder here.", "autoReveal", false);
      toggle("Type pages", "Give each type a page — a note with a table of all its notes — and open it when you click the type. Off: Typefold never creates type pages; clicking a type shows its notes in the sidebar list. Each type can also opt out on its own.", "openBaseOnClick", false);
      toggle("One folder open at a time", "Opening a type or folder closes the others, except the folders it sits in. Keeps a long tree short.", "oneFolderOpen", false);
    }

    if (this.tab === "notes") {
      heading("Above the title");
      toggle("Banner", "Show the cover / banner / image property above the title, and generated banners on type pages and folder notes.", "showBanner");
      toggle("Note icons", "Icons you pick for single notes, shown above the title.", "showPageIcons", false);
      toggle("Chips under the title", "Type, folder and property chips, plus the icon and banner buttons.", "showNoteChips", false);
      toggle("Hide Iconize title icons on type pages", "Iconize rules can put a big icon above a type page's title (e.g. a “Note” rule matching “Daily Notes”). The type's icon is already in its chip.", "hideIconizeOnTypePages", false);

      heading("In the note");
      new Setting(el).setName("Hide properties by default").setDesc("Use the properties chip or the status bar to show them.")
        .addToggle((t) => t.setValue(s.hideProperties).onChange(async (v) => {
          s.hideProperties = v; p.propsVisible = !v; await p.saveSettings(false); p.updateStatus();
        }));
      toggle("Type icons before links", "Prefix internal links with the linked note's type icon.", "linkIcons");
      toggle("Related objects", "Backlinks grouped by type, as cards at the bottom of the note.", "showRelated");
      toggle("View tabs for Bases", "Show a base's views as tabs next to the result count, for .base files and bases embedded in notes.", "viewTabs");

      heading("Folder notes");
      new Setting(el).setName("Use folder notes")
        .setDesc(this.app.plugins?.enabledPlugins?.has?.("folder-notes")
          ? "Clicking a folder opens its folder note, and folder notes get a header and a board. Off: Typefold ignores folder notes completely."
          : "Needs the Folder notes plugin (see More → Companion plugins). Off: Typefold ignores folder notes completely.")
        .addToggle((t) => t.setValue(s.useFolderNotes !== false).onChange(async (v) => { s.useFolderNotes = v; await p.saveSettings(); this.display(); }));
      if (s.useFolderNotes !== false)
        toggle("Create folder notes for new folders", "When you add a folder inside a type set to “Folder + subfolders”, give it a folder note with a board. Types set to “Don't create” or “This folder” never get new ones. Off: never.", "autoFolderNotes", false);
      heading("Files Typefold creates");
      new Setting(el).setName("Folder for type pages").setDesc("Where type pages and the shared Folder.base are created.")
        .addText((t) => t.setValue(s.basesFolder).setPlaceholder("Typefold")
          .onChange(async (v) => { s.basesFolder = v.trim() || "Typefold"; await p.saveSettings(false); }));
      new Setting(el).setName("Default folder for new objects")
        .addText((t) => t.setValue(s.defaultFolder).setPlaceholder("vault root")
          .onChange(async (v) => { s.defaultFolder = v.trim(); await p.saveSettings(false); }));
    }

    if (this.tab === "home") {
      heading("Home page");
      let noteRow;
      new Setting(el).setName("Home opens").setDesc("Typefold's dashboard, or any note you choose (put ```typefold-home``` in a note to embed the dashboard there).")
        .addDropdown((d) => d.addOptions({ typefold: "Typefold Home", note: "A note I choose" }).setValue(s.homeMode || "typefold")
          .onChange(async (v) => { s.homeMode = v; noteRow.settingEl.toggle(v === "note"); await p.saveSettings(false); }));
      noteRow = new Setting(el).setName("Home note").setDesc("The note opened by Home, the Home ribbon button and on startup.")
        .addText((t) => {
          t.setValue(s.homeNote || "").setPlaceholder("Home.md").onChange(async (v) => { s.homeNote = v.trim(); await p.saveSettings(false); });
          new NoteSuggest(this.app, t.inputEl);
        });
      noteRow.settingEl.toggle((s.homeMode || "typefold") === "note");
      toggle("Open Home on startup", "Show Home every time Obsidian starts.", "openHomeOnStartup", false);

      heading("Dashboard sections");
      toggle("Greeting", "The greeting and date at the top.", "homeGreeting", false);
      toggle("Object types", "A card for each type with its latest notes.", "homeTypes", false);
      toggle("Pinned", "Notes you pinned.", "homePinned", false);
      toggle("Recently edited", "Your latest notes.", "homeRecent", false);
      heading("Object types on Home", "Pick which types get a card on Home. Hidden types stay in the sidebar.");
      for (const t of p.visibleTypes()) {
        const row = new Setting(el).setName(t.label);
        row.nameEl.prepend(paintIcon(createSpan("ot-setting-icon"), p.iconFor(t.key), p.colorFor(t.key)));
        row.addToggle((tg) => tg.setValue(!s.types[t.key]?.hideOnHome).onChange(async (v) => {
          if (v) delete p.conf(t.key).hideOnHome; else p.conf(t.key).hideOnHome = true;
          await p.saveSettings(false); p.refreshViews();
        }));
      }
      heading("Greeting");
      new Setting(el).setName("Your name").setDesc("Used in the greeting.")
        .addText((t) => t.setValue(s.userName || "").onChange(async (v) => { s.userName = v.trim(); await p.saveSettings(false); }));

      heading("Weather");
      toggle("Weather on Home", "Uses open-meteo.com with the location below (no account needed). This is Typefold's only network request.", "showWeather", false);
      new Setting(el).setName("Location").setDesc("Place name, latitude, longitude")
        .addText((t) => t.setValue(s.weatherPlace || "").setPlaceholder("Seoul").onChange(async (v) => { s.weatherPlace = v.trim(); await p.saveSettings(false); }))
        .addText((t) => t.setValue(String(s.weatherLat ?? "")).onChange(async (v) => { s.weatherLat = parseFloat(v) || 0; p._wx = null; await p.saveSettings(false); }))
        .addText((t) => t.setValue(String(s.weatherLon ?? "")).onChange(async (v) => { s.weatherLon = parseFloat(v) || 0; p._wx = null; await p.saveSettings(false); }));
    }

    if (this.tab === "tasks") {
      heading("Source");
      const tnOk = !!p.taskNotes(), tpOk = !!p.tasksPlugin();
      new Setting(el).setName("Task source")
        .setDesc("Where Calendar and Tasks read tasks from. TaskNotes: one note per task. Tasks plugin: checkbox tasks the Tasks plugin tracks (its global filter, done dates and recurrence). Checkboxes: every `- [ ]` in your notes.")
        .addDropdown((d) => d.addOptions({
          tasknotes: "TaskNotes" + (tnOk ? "" : " (not installed)"),
          tasks: "Tasks plugin" + (tpOk ? "" : " (not installed)"),
          checkbox: "Checkboxes (- [ ])",
        }).setValue(s.taskSource || "checkbox").onChange(async (v) => { s.taskSource = v; await p.saveSettings(false); p.refreshTasks(); this.display(); }));
      const srcNote = s.taskSource === "tasknotes" && !tnOk ? "TaskNotes isn't installed or enabled, so no tasks will show. Install it from Community plugins, or pick another source."
        : s.taskSource === "tasks" && !tpOk ? "The Tasks plugin isn't installed or enabled. Until it is, Typefold reads checkboxes itself (📅 due and ⏳ scheduled dates included)."
        : "";
      if (srcNote) el.createEl("p", { cls: "setting-item-description ot-settings-warn", text: srcNote });
      heading("Showing tasks");
      toggle("Show completed tasks in the full view", "The full Tasks view lists completed tasks under “Completed”.", "taskShowDone", false);
      new Setting(el).setName("Sidebar views").setDesc(`${(s.taskPanelViews || DEFAULT_TASK_VIEWS).length} views. Right-click a view tab in the sidebar to rename it, change its icon, layout or filters.`)
        .addButton((b) => b.setButtonText("Reset to default views").onClick(async () => {
          s.taskPanelViews = null; s.taskPanelView = "today"; await p.saveSettings(); this.display();
        }));
      new Setting(el).setName("Open Tasks").setDesc("The full view with Month, Week, Day and List.")
        .addButton((b) => b.setButtonText("Open").onClick(() => p.openTasks()));
    }

    if (this.tab === "types") {
      heading("Object types", "Every folder you registered as a type. The switch shows or hides it in the sidebar.");
      const all = [...p.index.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
      if (!all.length) el.createEl("p", { cls: "setting-item-description", text: "No types yet. Use “New” in the sidebar or the command “Create new object type…”." });
      for (const [key, entry] of all) {
        const c = s.types[key] || {};
        const row = new Setting(el).setName(`${p.labelFor(key)}`).setDesc(`${entry.files.length} notes · ${p.typeFolders(key).join(", ") || "no folder"}`);
        row.nameEl.prepend(paintIcon(createSpan("ot-setting-icon"), p.iconFor(key), p.colorFor(key)));
        row.addExtraButton((b) => b.setIcon("palette").setTooltip("Icon & color").onClick(() =>
          new TypeConfigModal(p, key, () => this.display()).open()));
        row.addExtraButton((b) => b.setIcon("trash-2").setTooltip("Delete type…").onClick(() => {
          const m = new DeleteTypeModal(p, key);
          const close = m.onClose.bind(m);
          m.onClose = () => { close(); this.display(); };
          m.open();
        }));
        row.addToggle((t) => t.setTooltip("Show in sidebar").setValue(!c.hidden).onChange(async (v) => {
          p.conf(key).hidden = !v; await p.saveSettings();
        }));
      }
    }

    if (this.tab === "more") {
      heading("Companion plugins", "Typefold works on its own. These add to it — install any you like.");
      for (const comp of COMPANIONS) {
        const installed = !!this.app.plugins?.manifests?.[comp.id];
        const enabled = !!this.app.plugins?.enabledPlugins?.has(comp.id);
        const row = new Setting(el).setName(comp.name + (comp.mine ? " ✦" : "")).setDesc(comp.why);
        if (enabled) row.addButton((b) => b.setButtonText("Enabled").setDisabled(true));
        else if (installed) row.addButton((b) => b.setButtonText("Enable").setCta().onClick(async () => { await this.app.plugins.enablePluginAndSave(comp.id); this.display(); }));
        else row.addButton((b) => b.setButtonText("Install").onClick(() => window.open(`obsidian://show-plugin?id=${comp.id}`)));
      }
      heading("About");
      new Setting(el).setName(`Typefold ${p.manifest.version}`).setDesc("The guide and the list of changes in this version.")
        .addButton((b) => b.setButtonText("What's new").onClick(() => new WhatsNewModal(p, "new").open()))
        .addButton((b) => b.setButtonText("Guide").onClick(() => new WhatsNewModal(p, "guide").open()));
      heading("Developer");
      toggle("Reload when plugin files change", "For editing this plugin: reload it automatically when main.js or styles.css change.", "devAutoReload", false);
    }
  }
}

/* track this plugin's open dialogs so they can be closed properly on unload */
for (const C of [QuickOpenModal, IconColorModal, NoteIconModal, TypeConfigModal, NewTypeModal, DeleteTypeModal, TypePickerModal, BannerPickerModal, TaskViewModal, ConfirmModal, WhatsNewModal]) {
  const open = C.prototype.open, close = C.prototype.close;
  C.prototype.open = function (...a) { OPEN_MODALS.add(this); return open.apply(this, a); };
  C.prototype.close = function (...a) { OPEN_MODALS.delete(this); return close.apply(this, a); };
}

module.exports = TypefoldPlugin;

/* nosourcemap */