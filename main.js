/* Typefold — folders as object types: navigator, type pages, Home, new-tab search, view tabs for Bases (plain JS) */
const {
  Plugin, ItemView, PluginSettingTab, Setting, Modal, SuggestModal, Notice, AbstractInputSuggest, TFolder, Menu, MarkdownView, Platform,
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


/* first-run mapping of this vault's existing types to folders */
const FOLDER_TYPE_SEED = {}; // first-run mapping of existing `type` values to folders (empty in the public release)

/** optional plugins Typefold integrates with (✦ = made by the same author) */
const COMPANIONS = [
  { id: "extended-base", name: "Extended Base", mine: true, why: "Notion-style Board / List / Feed views for type pages and folder boards. Without it, pages use the core Table and Cards views." },
  { id: "folder-notes", name: "Folder notes", why: "Clicking a folder opens its folder note, and new folders get a board page." },
  { id: "obsidian-icon-folder", name: "Iconize", why: "Use Iconize's icons (Font Awesome, Boxicons, emoji…) in the panel and keep both in sync." },
  { id: "notion-style-comments", name: "Notion-style Comments", mine: true, why: "Notion-like margin comments that match this look." },
  { id: "notion-selection-toolbar", name: "Notion Selection Toolbar", mine: true, why: "A floating formatting toolbar in the same style." },
  { id: "calendar", name: "Calendar", why: "The Calendar entry at the top of the panel opens its calendar view." },
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
  smartItems: ["smart:home", "smart:inbox", "smart:calendar"],
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
    this.registerView(VIEW_TYPE, (leaf) => new TypefoldView(leaf, this));
    this.registerView(HOME_VIEW, (leaf) => new HomeView(leaf, this));
    this.addRibbonIcon("house", "Home", () => this.openHome());
    this.addCommand({ id: "open-home", name: "Open home dashboard", callback: () => this.openHome() });
    this.addCommand({ id: "quick-open", name: "Search and open a page…", callback: () => new QuickOpenModal(this, null).open() });
    this.addCommand({ id: "reveal-file", name: "Reveal current file in navigator", callback: () => this.revealFile(this.app.workspace.getActiveFile()) });
    this.addCommand({ id: "toggle-default-explorer", name: "Toggle: use as default file explorer", callback: async () => {
      this.settings.replaceExplorer = !this.settings.replaceExplorer;
      await this.saveSettings(false);
      new Notice(this.settings.replaceExplorer ? "Typefold is now your file explorer." : "Core file explorer restored.");
    } });
    this.addRibbonIcon("shapes", "Typefold", () => this.activateView());
    this.addCommand({ id: "open-sidebar", name: "Open object types navigator", callback: () => this.activateView() });
    this.addCommand({ id: "new-object", name: "Create new object…", callback: () => this.newObjectFlow() });
    this.addCommand({ id: "new-type", name: "Create new object type…", callback: () => new NewTypeModal(this).open() });
    this.addCommand({ id: "toggle-properties", name: "Toggle properties in object notes", callback: () => this.toggleProps() });
    this.addSettingTab(new TypefoldSettingTab(this.app, this));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("ot-status");

    this.requestRebuild = debounce(() => this.rebuild(), 300, true);
    this.requestDecorate = debounce(() => this.decorateAll(), 150, true);
    const soft = debounce(() => this.softRefresh(), 900, true);
    this.registerEvent(this.app.metadataCache.on("changed", () => soft()));
    let firstResolve = true;
    this.registerEvent(this.app.metadataCache.on("resolved", () => { if (firstResolve) { firstResolve = false; this.requestRebuild(); } }));
    this.registerEvent(this.app.vault.on("create", () => this.requestRebuild()));
    this.registerEvent(this.app.vault.on("delete", () => this.requestRebuild()));
    const refreshHome = debounce(() => this.app.workspace.getLeavesOfType(HOME_VIEW).forEach((l) => l.view?.render?.()), 1500, true);
    this.registerEvent(this.app.vault.on("modify", () => refreshHome()));
    this.registerEvent(this.app.vault.on("rename", (f, old) => { this.renamePinned(old, f.path); this.requestRebuild(); }));
    this.registerEvent(this.app.workspace.on("file-open", (file) => { this.requestDecorate(); this.refreshViews(true); this.autoReveal(file); }));
    this.registerEvent(this.app.workspace.on("layout-change", () => this.requestDecorate()));
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
        const existing = this.app.workspace.getLeavesOfType(HOME_VIEW)[0];
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
        if ((await stamp()) === initial) return;
        const plugins = this.app.plugins, id = this.manifest.id;
        await plugins.disablePlugin(id);
        await plugins.enablePlugin(id);
      }, 2500));
    });
  }

  onunload() {
    for (const m of [...OPEN_MODALS]) { try { m.close(); } catch (e) {} }
    OPEN_MODALS.clear();
    document.body.removeClass("ot-theme", "ot-hide-props", "ot-replace-explorer");
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
    this.register(() => document.querySelectorAll(".ot-view-tabs").forEach((e) => e.remove()));
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

  /** expand the tree down to (and including) a folder; returns true if anything changed */
  expandTo(path) {
    if (!path) return false;
    let best = null, bestLen = -1;
    for (const k of Object.keys(this.settings.types)) {
      if (k.includes(":") || !this.settings.types[k].registered || this.settings.types[k].hidden) continue;
      for (const f of this.typeFolders(k)) if ((path === f || path.startsWith(f + "/")) && f.length > bestLen) { best = k; bestLen = f.length; }
    }
    if (!best) return false;
    const root = this.typeRoot(best);
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
    return key.startsWith("file:") ? out : out.filter((f) => !this.isFolderNote(f));
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
    if (fk) return (this.index.get(fk.type)?.files || []).filter((f) => f.path.startsWith(fk.path + "/"));
    if (key === "smart:inbox") {
      const root = normalizePath(this.settings.basesFolder || "Typefold") + "/";
      return this.app.vault.getMarkdownFiles().filter((f) => !this.fileType.has(f.path) && !f.path.startsWith(root));
    }
    if (key === "smart:tasks") return this.app.vault.getMarkdownFiles().filter((f) =>
      (this.app.metadataCache.getFileCache(f)?.listItems || []).some((li) => li.task === " "));
    if (key === "smart:calendar") {
      const daily = this.app.internalPlugins?.getPluginById?.("daily-notes")?.instance?.options || {};
      const folder = (daily.folder || "").replace(/\/$/, "");
      const fmt = daily.format || "YYYY-MM-DD";
      return this.app.vault.getMarkdownFiles().filter((f) =>
        (!folder || f.path.startsWith(folder + "/")) && moment(f.basename, fmt, true).isValid());
    }
    return this.index.get(key)?.files || [];
  }

  /* ── object types: create / assign ── */
  async registerType({ label, icon, color, folder, assign, folderNote }) {
    const key = label.trim().toLowerCase();
    const c = this.conf(key);
    Object.assign(c, { label: label.trim(), icon, color, registered: true });
    delete c.hidden;
    if (folder) c.folders = [...new Set([...(c.folders || []), normalizePath(folder)])];
    const order = (this.settings.typeOrder ||= []);
    if (!order.includes(key)) order.push(key);
    await this.saveSettings(false);
    let changed = 0;
    if (folder) {
      await this.ensureFolder(normalizePath(folder));
      if (assign) changed = await this.assignFolder(folder, label.trim());
      if (folderNote) await this.ensureFolderNotesUnder(folder, label.trim());
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

  folderNoteContent(typeLabel, folderPath) {
    const lines = [];
    let best = null, bestLen = -1;
    for (const k of Object.keys(this.settings.types)) {
      if (k.includes(":")) continue;
      for (const f of this.typeFolders(k)) if (folderPath.startsWith(f + "/") && f.length > bestLen) { best = k; bestLen = f.length; }
    }
    if (best) for (const [k, v] of Object.entries(this.folderLevelProps(best, folderPath))) lines.push(`${k}: ${JSON.stringify(v)}`);
    lines.push("cssclasses:", "  - max");
    return "---\n" + lines.join("\n") + `\n---\n\n![[${normalizePath(this.settings.basesFolder || "Typefold")}/Folder.base]]\n`;
  }

  async ensureFolderNote(folderPath, typeLabel) {
    const st = this.fnSettings();
    if (!st.enabled || !folderPath) return null;
    const existing = this.folderNoteOf(folderPath);
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

  async ensureFolderNotesUnder(folder, typeLabel) {
    const root = this.app.vault.getAbstractFileByPath(normalizePath(folder));
    if (!(root instanceof TFolder)) return;
    const walk = async (fo) => {
      if (fo.name.startsWith(".") || fo.name.startsWith("_")) return;
      await this.ensureFolderNote(fo.path, typeLabel);
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
    const inType = Object.keys(this.settings.types).some((k) => this.typeFolders(k).some((f) => folder.path.startsWith(f + "/")));
    if (inType) await this.ensureFolderNote(folder.path, null);
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
      enabled: !!this.app.plugins?.enabledPlugins?.has?.("folder-notes"),
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
      const page = this.app.vault.getAbstractFileByPath(this.basePath(key, null));
      if (page) await this.app.vault.trash(page, false);
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
      let txt = await this.app.vault.read(existing);
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

  async openTypeBase(key, newTab = false) {
    try {
      await this.baseFileFor(key); // keeps the embedded page's filter in sync with the type's folders
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
    const fk = this.parseFolderKey(key);
    if (fk) key = fk.type;
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
    const lines = this.settings.types[key]?.matchProperty || !this.typeFolders(key).length ? [`${this.prop}: ${JSON.stringify(label)}`] : [];
    for (const [k, v] of Object.entries(props)) lines.push(`${k}: ${JSON.stringify(v)}`);
    const file = await this.app.vault.create(path, lines.length ? `---\n${lines.join("\n")}\n---\n\n` : "");
    await this.app.workspace.getLeaf(false).openFile(file, { eState: { rename: "all" } });
    return file;
  }

  /* ── views ── */
  async openHome(newTab = false) {
    const existing = this.app.workspace.getLeavesOfType(HOME_VIEW)[0];
    if (existing && !newTab) { this.app.workspace.revealLeaf(existing); return; }
    const leaf = this.app.workspace.getLeaf(newTab ? "tab" : false);
    await leaf.setViewState({ type: HOME_VIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  refreshViews(activeOnly = false) {
    for (const leaf of this.app.workspace.getLeavesOfType(HOME_VIEW)) leaf.view?.render?.();
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

  decorate(view) {
    const file = view.file;
    const root = view.contentEl;
    root.querySelectorAll(".ot-note-header, .ot-related").forEach((el) => el.remove());
    if (!file) return;
    const typeKey = this.typeOfFile(file);
    const fnFolder = this.folderOfFolderNote(file);
    const typePage = this.typePageKey(file);
    view.containerEl.toggleClass("ot-object-note", !!typeKey || !!fnFolder || !!typePage);
    view.containerEl.toggleClass("ot-folder-note", !!fnFolder || !!typePage);

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
    if (this.settings.showBanner) {
      const src = this.thumbnailFor(file, true);
      if (src) header.createDiv("ot-banner").createEl("img", { attr: { src } });
      else {
        const b = header.createDiv("ot-banner ot-banner-generated");
        b.style.setProperty("--ot-color", color);
        setIcon(b.createDiv("ot-banner-glyph"), this.iconFor(key));
        b.createDiv({ cls: "ot-banner-path", text: this.typeFolders(key).join("  ·  ") || "Object type" });
      }
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
      if (src) header.createDiv("ot-banner").createEl("img", { attr: { src } });
      else if (fnFolder) {
        // folder notes without a cover get a generated banner in the type colour
        const b = header.createDiv("ot-banner ot-banner-generated");
        b.style.setProperty("--ot-color", color);
        setIcon(b.createDiv("ot-banner-glyph"), fstyle?.icon || "folder-open");
        const crumbs = b.createDiv("ot-banner-path");
        crumbs.setText(fnFolder.path.split("/").join("  ›  "));
      }
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

    const hasBanner = !!this.bannerKey(file);
    const bbtn = chips.createDiv("ot-chip-btn");
    setIcon(bbtn, hasBanner ? "image" : "image-plus");
    bbtn.setAttr("aria-label", hasBanner ? "Banner" : "Add banner");
    bbtn.onclick = (evt) => {
      if (!hasBanner) return new BannerPickerModal(this, file).open();
      const m = new Menu();
      m.addItem((i) => i.setTitle("Change banner").setIcon("image").onClick(() => new BannerPickerModal(this, file).open()));
      m.addItem((i) => i.setTitle("Remove banner").setIcon("trash-2").onClick(() => this.setBanner(file, null)));
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

  bannerKey(file) {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter || {};
    return THUMB_KEYS.find((k) => this.resolveImage(fm[k], file.path)) || null;
  }

  async setBanner(file, value) {
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
    sb.createSpan({ cls: "ot-kbd", text: "⌘O" });
    sb.onclick = () => this.app.commands.executeCommandById("switcher:open");
    const nb = actions.createDiv("ot-new-btn");
    setIcon(nb.createSpan(), "plus");
    nb.createSpan({ text: "New" });
    nb.onclick = () => p.newObjectFlow();

    /* object types */
    const sec1 = wrap.createDiv("ot-home-section");
    const t1 = sec1.createDiv("ot-home-title");
    t1.createSpan({ text: "Object types" });
    this.sectionMenu(t1, [
      ["Notes per card", [0, 1, 3, 5].map((n) => [n ? `${n}` : "None", () => this.setHome({ typeNotes: n }), this.hs().typeNotes === n])],
    ]);
    const grid = sec1.createDiv("ot-home-types");
    for (const t of p.visibleTypes()) {
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
      const sec = wrap.createDiv("ot-home-section");
      sec.createDiv({ cls: "ot-home-title", text: "Pinned" });
      const g = sec.createDiv("ot-home-recent");
      pins.forEach((f) => this.noteCard(g, f));
    }

    /* recently edited */
    const hs = this.hs();
    const sec2 = wrap.createDiv("ot-home-section");
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
  async onClose() { this.resizeObs?.disconnect(); }

  select(key, opts = {}) {
    this.listLimit = 0;
    this.plugin.settings.lastSelected = key;
    this.plugin.saveData(this.plugin.settings);
    if (key === "smart:calendar" && this.app.commands?.commands?.["calendar:show-calendar-view"]) {
      this.app.commands.executeCommandById("calendar:show-calendar-view");
    }
    this.selected = key;
    this.query = "";
    this.app.workspace.requestSaveLayout();
    this.render();
    const fk = this.plugin.parseFolderKey(key);
    if (fk) {
      const note = this.plugin.folderNoteOf(fk.path);
      if (note && !opts.noOpen) this.app.workspace.getLeaf(false).openFile(note);
    } else if (key && !key.includes(":") && this.plugin.settings.openBaseOnClick && !opts.noOpen) this.plugin.openTypeBase(key);
  }

  render() {
    const el = this.contentEl;
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
    search.createSpan({ cls: "ot-kbd", text: "⌘O" });
    search.onclick = () => this.app.commands.executeCommandById("switcher:open");
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
      for (const sm of SMART.filter((x) => shown.includes(x.key))) {
        const r = row(s, sm.key, sm.label, { icon: sm.icon, color: "#8E8E93", menu: (e) => {
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
    const types = p.visibleTypes();
    if (!types.length) ts.createDiv({ cls: "ot-empty", text: `No notes with a "${p.prop}" property yet.` });
    for (const t of types) {
      const r = this.makeSortable(row(ts, t.key, t.label, { count: t.count }), t.key, types) || null;
      this.renderFolderTree(ts, t.key, p.typeRoot(t.key), 1, ts.lastElementChild);
    }

    this.renderArchive(scroll);

    if (p.settings.showFiles) {
      const fs = section("Files");
      for (const t of p.visibleTypes({ files: true })) {
        const r = row(fs, t.key, t.label, { count: t.count });
        this.renderFolderTree(fs, t.key, p.typeRoot(t.key), 1, r);
      }
      for (const fc of FILE_COLLECTIONS) {
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
    const show = ["md", "canvas", "base", "pdf", ...IMG_EXT];
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
      const icon = f.extension === "md" ? "file-text" : f.extension === "canvas" ? "layout-dashboard" : f.extension === "base" ? "table" : f.extension === "pdf" ? "file-type" : "image";
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
      if (open) delete p.settings.expanded[nodeKey]; else p.settings.expanded[nodeKey] = true;
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

  noteMenu(evt, file) {
    const p = this.plugin;
    const m = new Menu();
    m.addItem((i) => i.setTitle(p.isPinned("note", file.path) ? "Unpin" : "Pin").setIcon("pin").onClick(() => p.togglePin("note", file.path)));
    const arch = p.isArchived(file.path);
    m.addItem((i) => i.setTitle(arch ? "Unarchive" : "Archive").setIcon(arch ? "archive-restore" : "archive").onClick(() => p.setArchived(file.path, !arch)));
    m.addItem((i) => i.setTitle("Open in new tab").setIcon("file-plus").onClick(() => this.app.workspace.getLeaf("tab").openFile(file)));
    m.addItem((i) => i.setTitle("Open to the right").setIcon("separator-vertical").onClick(() => this.app.workspace.getLeaf("split").openFile(file)));
    this.app.workspace.trigger("file-menu", m, file, VIEW_TYPE, this.leaf);
    m.showAtMouseEvent(evt);
  }

  /* ── right pane ── */
  /* ── list preferences (per type) ── */
  prefKey(key) { const fk = this.plugin.parseFolderKey(key); return fk ? fk.type : key; }
  listPrefs(key) {
    const all = (this.plugin.settings.listPrefs ||= {});
    const d = { sort: "edited", dir: "desc", group: "date" };
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
    const fk = p.parseFolderKey(key);
    const isType = !key.includes(":") || !!fk;
    const files = this.sortedFiles(key);
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

    const tools = createDiv("ot-list-tools");
    const hbtn = (icon, tip, fn) => {
      const b = tools.createDiv("clickable-icon ot-head-btn");
      setIcon(b, icon);
      b.setAttr("aria-label", tip);
      b.onclick = fn;
      return b;
    };
    const pr = this.listPrefs(key);
    hbtn("arrow-up-down", "Sort", (evt) => {
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
    const gb = hbtn("layers", "Group by", (evt) => {
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
    gb.toggleClass("is-active", pr.group !== "none");
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

    const listEl = pane.createDiv("ot-list");
    listEl.toggleClass("is-grid", p.settings.listMode === "grid");
    const draw = () => {
      listEl.empty();
      const q = this.query.toLowerCase();
      const visible = files.filter((f) => !q || f.basename.toLowerCase().includes(q));
      const metaTs = (f) => this.sortTime(f, pr.sort === "created" ? "created" : "edited");
      // render in chunks: big types used to build every row up front
      const limit = this.listLimit || 150;
      let shown = 0, hidden = 0;
      const put = (parent, f) => {
        if (shown >= limit) { hidden++; return; }
        shown++;
        return p.settings.listMode === "grid" ? this.renderCard(parent, f, key) : this.renderItem(parent, f, metaTs(f));
      };
      const finish = () => {
        if (!hidden) return;
        const more = listEl.createDiv("ot-show-more");
        more.setText(`Show ${Math.min(hidden, 150)} more · ${hidden} left`);
        more.onclick = () => { this.listLimit = limit + 150; draw(); };
        const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) { io.disconnect(); more.click(); } }, { root: listEl, rootMargin: "300px" });
        io.observe(more);
      };
      if (pr.group === "none") {
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

  renderItem(listEl, file, ts) {
    const item = listEl.createDiv("ot-item");
    const text = item.createDiv("ot-item-text");
    text.createDiv({ cls: "ot-item-title", text: file.extension === "md" ? file.basename : file.name });
    text.createDiv({ cls: "ot-item-meta", text: relTime(ts) });
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
    card.createDiv({ cls: "ot-card-title", text: file.extension === "md" ? file.basename : file.name });
    this.bindFile(card, file);
  }

  markActive() {
    const active = this.app.workspace.getActiveFile()?.path;
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
    return this.images.filter((f) => !ql || f.path.toLowerCase().includes(ql)).slice(0, 60).map((f) => ({ file: f }));
  }
  renderSuggestion(item, el) {
    el.addClass("ot-banner-option");
    const src = item.url || this.app.vault.getResourcePath(item.file);
    el.createEl("img", { cls: "ot-banner-option-img", attr: { src, loading: "lazy" } });
    const t = el.createDiv("ot-banner-option-text");
    t.createDiv({ text: item.url ? "Use image URL" : item.file.basename });
    t.createDiv({ cls: "ot-banner-option-path", text: item.url || item.file.parent?.path || "/" });
  }
  onChooseSuggestion(item) {
    this.plugin.setBanner(this.file, item.url || `[[${item.file.path}]]`);
  }
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
    const page = p.app.vault.getAbstractFileByPath(p.basePath(key, null));
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
    check(`Move its page (${page?.path}) to the trash`, "removePage", !!page);
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

class NewTypeModal extends Modal {
  constructor(plugin, preset = {}, onDone) { super(plugin.app); this.plugin = plugin; this.preset = preset; this.onDone = onDone; }
  onOpen() {
    const p = this.plugin;
    const d = {
      label: this.preset.label || "", folder: this.preset.folder || "",
      icon: "box", color: COLORS[6].hex, assign: true, folderNote: true,
    };
    if (d.label) for (const [re, ic] of ICON_GUESS) if (re.test(d.label.toLowerCase())) { d.icon = ic; break; }
    this.modalEl.addClass("ot-modal", "ot-config-modal");
    this.titleEl.setText("New object type");
    const el = this.contentEl;

    const preview = el.createDiv("ot-config-preview");
    const pIcon = preview.createSpan();
    const pLabel = preview.createSpan({ cls: "ot-config-preview-label" });

    const nameIn = el.createEl("input", { cls: "ot-modal-input ot-type-name", type: "text", placeholder: "Type name, e.g. ACTIVITY, People, Books" });
    nameIn.value = d.label;

    el.createDiv({ cls: "ot-config-label", text: "Color" });
    const swatches = el.createDiv("ot-swatches");
    { const s0 = swatches.createDiv("ot-swatch ot-swatch-none"); s0.dataset.hex = NO_COLOR; s0.setAttr("aria-label", "No color"); s0.onclick = () => { d.color = NO_COLOR; refresh(); }; }
    for (const col of COLORS) {
      const s = swatches.createDiv("ot-swatch");
      s.dataset.hex = col.hex;
      s.style.setProperty("--ot-color", col.hex);
      s.setAttr("aria-label", col.name);
      s.onclick = () => { d.color = col.hex; refresh(); };
    }
    el.createDiv({ cls: "ot-config-label", text: "Icon" });
    const search = el.createEl("input", { cls: "ot-modal-input", type: "text", placeholder: "Search all icons…" });
    const grid = el.createDiv("ot-icon-grid");
    const allIcons = (getIconIds?.() || []).map((id) => id.replace(/^lucide-/, "")).filter((id, i, a) => a.indexOf(id) === i);

    el.createDiv({ cls: "ot-config-label", text: "Folder" });
    const folderIn = el.createEl("input", { cls: "ot-modal-input", type: "text", placeholder: "Pick or type a folder (created if it doesn't exist)" });
    folderIn.value = d.folder;
    new FolderSuggest(this.app, folderIn);
    const info = el.createDiv("ot-newtype-info");
    const opts = el.createDiv("ot-newtype-opts");
    const check = (label, k) => {
      const row = opts.createEl("label", { cls: "ot-check" });
      const cb = row.createEl("input", { type: "checkbox" });
      cb.checked = d[k];
      cb.onchange = () => { d[k] = cb.checked; };
      row.createSpan({ text: label });
      return row;
    };
    d.assign = false;
    check("Add a board folder note to the folder and its subfolders", "folderNote");

    const refresh = () => {
      d.label = nameIn.value.trim();
      d.folder = folderIn.value.trim().replace(/\/$/, "");
      paintIcon(pIcon, d.icon, d.color);
      pLabel.setText(d.label || "New type");
      swatches.querySelectorAll(".ot-swatch").forEach((s) => s.toggleClass("is-selected", s.dataset.hex === d.color));
      grid.querySelectorAll(".ot-icon-cell").forEach((s) => s.toggleClass("is-selected", s.dataset.icon === d.icon));
      grid.style.setProperty("--ot-color", d.color);
      const prefix = d.folder ? normalizePath(d.folder) + "/" : null;
      const n = prefix ? this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix)).length : 0;
      const exists = d.folder && this.app.vault.getAbstractFileByPath(normalizePath(d.folder));
      info.setText(!d.folder ? "Pick the folder this type stands for. Everything inside it belongs to the type."
        : exists ? `${n} notes in this folder (and its subfolders) will belong to this type. Nothing is written to them.`
        : "This folder will be created.");
      save.disabled = !d.label || !d.folder;
    };
    const drawIcons = () => {
      grid.empty();
      const q = search.value.trim().toLowerCase();
      const ids = q ? searchIcons(q) : SUGGESTED_ICONS;
      for (const id of ids) {
        const cell = grid.createDiv("ot-icon-cell");
        cell.dataset.icon = id;
        cell.setAttr("aria-label", id);
        setIcon(cell, id);
        if (!cell.firstChild) { cell.remove(); continue; }
        cell.onclick = () => { d.icon = id; refresh(); };
      }
      refresh();
    };
    search.oninput = drawIcons;
    nameIn.oninput = refresh;
    folderIn.oninput = refresh;

    const buttons = el.createDiv("ot-config-buttons");
    buttons.createDiv("ot-spacer");
    const cancel = buttons.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const save = buttons.createEl("button", { cls: "mod-cta", text: "Create type" });
    save.onclick = async () => {
      if (!d.label) return;
      save.disabled = true; save.setText("Creating…");
      const { key, changed } = await p.registerType(d);
      new Notice(`Created type “${d.label}”${changed ? ` and set it on ${changed} notes` : ""}.`);
      this.close();
      this.onDone?.(key);
      p.activateView().then(() => p.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view?.select(key));
    };
    drawIcons();
    setTimeout(() => nameIn.focus(), 0);
  }
  onClose() { this.contentEl.empty(); }
}

class TypeConfigModal extends Modal {
  constructor(plugin, key, onDone) { super(plugin.app); this.plugin = plugin; this.key = key; this.onDone = onDone; }
  onOpen() {
    const p = this.plugin, key = this.key;
    const c = p.conf(key);
    const fkey = p.parseFolderKey(key);
    const izNow = fkey && !c.icon ? p.iconizeInfo(fkey.path) : null;
    const draft = {
      icon: (izNow && (TypefoldPlugin.iconizeToLucide(izNow.name) || izNow.name)) || p.iconFor(key),
      color: izNow?.color || p.colorFor(key), folder: c.folder || "", label: c.label || "",
    };
    const isType = !key.includes(":");
    this.modalEl.addClass("ot-modal", "ot-config-modal");
    this.titleEl.setText(p.labelFor(key));

    const preview = this.contentEl.createDiv("ot-config-preview");
    const pIcon = preview.createSpan("ot-config-preview-icon");
    preview.createSpan({ cls: "ot-config-preview-label", text: p.labelFor(key) });
    const refresh = () => {
      paintIcon(pIcon, draft.icon, draft.color);
      swatches.querySelectorAll(".ot-swatch").forEach((s) => s.toggleClass("is-selected", s.dataset.hex === draft.color));
      grid.querySelectorAll(".ot-icon-cell").forEach((s) => s.toggleClass("is-selected", s.dataset.icon === draft.icon));
      grid.style.setProperty("--ot-color", draft.color);
    };

    /* color presets */
    this.contentEl.createDiv({ cls: "ot-config-label", text: "Color" });
    const swatches = this.contentEl.createDiv("ot-swatches");
    { const s0 = swatches.createDiv("ot-swatch ot-swatch-none"); s0.dataset.hex = NO_COLOR; s0.setAttr("aria-label", "No color"); s0.onclick = () => { draft.color = NO_COLOR; refresh(); }; }
    for (const col of COLORS) {
      const s = swatches.createDiv("ot-swatch");
      s.dataset.hex = col.hex;
      s.style.setProperty("--ot-color", col.hex);
      s.setAttr("aria-label", col.name);
      s.onclick = () => { draft.color = col.hex; refresh(); };
    }

    /* icon grid */
    this.contentEl.createDiv({ cls: "ot-config-label", text: "Icon" });
    const search = this.contentEl.createEl("input", { cls: "ot-modal-input", type: "text", placeholder: "Search all icons…" });
    const grid = this.contentEl.createDiv("ot-icon-grid");
    const allIcons = (getIconIds?.() || []).map((id) => id.replace(/^lucide-/, "")).filter((id, i, a) => a.indexOf(id) === i);
    const drawIcons = () => {
      grid.empty();
      const q = search.value.trim().toLowerCase();
      const ids = q ? searchIcons(q) : SUGGESTED_ICONS;
      if (!ids.length) grid.createDiv({ cls: "ot-empty", text: "No icons found" });
      for (const id of ids) {
        const cell = grid.createDiv("ot-icon-cell");
        cell.dataset.icon = id;
        cell.setAttr("aria-label", id);
        setIcon(cell, id);
        if (!cell.firstChild) { cell.remove(); continue; }
        cell.onclick = () => { draft.icon = id; refresh(); };
      }
      refresh();
    };
    search.oninput = drawIcons;
    drawIcons();

    if (isType) {
      new Setting(this.contentEl).setName("Display name")
        .addText((t) => t.setValue(draft.label).setPlaceholder(p.index.get(key)?.label || key).onChange((v) => { draft.label = v.trim(); }));
      draft.folders = p.typeFolders(key).join("\n");
      new Setting(this.contentEl).setName("Folders").setDesc("One per line. Notes inside these folders belong to this type; new notes go into the first one.")
        .addTextArea((t) => { t.setValue(draft.folders).setPlaceholder("e.g. School").onChange((v) => { draft.folders = v; }); t.inputEl.rows = 3; t.inputEl.addClass("ot-folders-input"); });
      const lvl = (c.folderProps || []).map((x) => (typeof x === "string" ? x : x.match ? `${x.name}=${x.match}` : x.name)).join(", ");
      new Setting(this.contentEl).setName("Properties from folders")
        .setDesc("One name per folder level below the type's folder, comma-separated. e.g. “semester, course” fills semester from the 1st level and course from the 2nd. Add =regex to only use matching folder names.")
        .addText((t) => t.setValue(lvl).setPlaceholder("semester, course").onChange((v) => { draft.folderProps = v; }));
      const defs = Object.entries(c.defaultProps || {}).map(([k, v]) => `${k}: ${v}`).join("\n");
      new Setting(this.contentEl).setName("Properties for new notes")
        .setDesc("One “name: value” per line. {{date}} becomes today's date.")
        .addTextArea((t) => { t.setValue(defs).setPlaceholder("status: to-do\ncreated: {{date}}").onChange((v) => { draft.defaultProps = v; }); t.inputEl.rows = 3; t.inputEl.addClass("ot-folders-input"); });
      new Setting(this.contentEl).setName("Also match the type property").setDesc(`Include notes anywhere whose “${p.prop}” is “${p.labelFor(key)}”.`)
        .addToggle((t) => t.setValue(!!c.matchProperty).onChange((v) => { draft.matchProperty = v; }));
    }

    const buttons = this.contentEl.createDiv("ot-config-buttons");
    const reset = buttons.createEl("button", { text: "Reset" });
    reset.onclick = () => { delete c.icon; delete c.color; draft.icon = p.iconFor(key); draft.color = p.colorFor(key); refresh(); };
    buttons.createDiv("ot-spacer");
    const save = buttons.createEl("button", { cls: "mod-cta", text: "Done" });
    save.onclick = async () => {
      const fresh = await p.loadData();
      if (fresh) { p.settings = Object.assign({}, DEFAULT_SETTINGS, fresh); p.settings.types ||= {}; }
      const c = p.conf(key);
      c.icon = draft.icon; c.color = draft.color;
      // keep Iconize in step: folders store their icon in Iconize; types write theirs onto their folder(s)
      if (p.iconizePlugin()) {
        const fk2 = p.parseFolderKey(key);
        const isDefault = draft.icon === "folder" && (!draft.color || draft.color === p.colorFor(fk2?.type || key));
        if (fk2) { await p.writeIconize(fk2.path, isDefault ? null : draft.icon, draft.color); delete c.icon; if (isDefault) delete c.color; }
        else if (!key.includes(":")) for (const f of p.typeFolders(key)) await p.writeIconize(f, draft.icon, draft.color);
      }
      if (isType) {
        if (draft.folders != null) c.folders = draft.folders.split("\n").map((x) => x.trim().replace(/\/$/, "")).filter(Boolean);
        if (draft.matchProperty != null) c.matchProperty = draft.matchProperty;
        if (draft.folderProps != null) c.folderProps = draft.folderProps.split(",").map((x) => x.trim()).filter(Boolean)
          .map((x) => x.includes("=") ? { name: x.split("=")[0].trim(), match: x.slice(x.indexOf("=") + 1).trim() } : x);
        if (draft.defaultProps != null) {
          const o = {};
          for (const line of draft.defaultProps.split("\n")) { const i = line.indexOf(":"); if (i > 0) o[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
          c.defaultProps = o;
        }
        delete c.folder;
        if (draft.label) c.label = draft.label; else delete c.label;
      }
      await p.saveSettings();
      this.close();
      this.onDone?.();
    };
  }
  onClose() { this.contentEl.empty(); }
}

/* ───────────────────────────── Settings ───────────────────────────── */

class TypefoldSettingTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const p = this.plugin, el = this.containerEl;
    el.empty();
    const s = p.settings;
    const toggle = (name, desc, k) => new Setting(el).setName(name).setDesc(desc)
      .addToggle((t) => t.setValue(s[k]).onChange(async (v) => { s[k] = v; await p.saveSettings(); }));

    new Setting(el).setName("Navigator").setHeading();
    new Setting(el).setName("Use as default file explorer")
      .setDesc("Hides the core File explorer tab, opens this panel on startup, and sends “Open file explorer” and “Reveal current file in navigation” here.")
      .addToggle((t) => t.setValue(!!s.replaceExplorer).onChange(async (v) => {
        s.replaceExplorer = v; await p.saveSettings(false);
        if (v) p.activateView();
      }));
    new Setting(el).setName("Type property").setDesc("Frontmatter property that defines a note's object type.")
      .addText((t) => t.setValue(s.property).onChange(async (v) => { s.property = v.trim() || "type"; await p.saveSettings(); }));
    new Setting(el).setName("Minimum notes per type").setDesc("Hide types with fewer notes than this.")
      .addSlider((sl) => sl.setLimits(1, 10, 1).setValue(s.minCount).setDynamicTooltip()
        .onChange(async (v) => { s.minCount = v; await p.saveSettings(); }));
    new Setting(el).setName("Sort types by")
      .addDropdown((d) => d.addOptions({ manual: "Manual (drag in sidebar)", name: "Name", count: "Note count" }).setValue(s.sortTypes)
        .onChange(async (v) => { s.sortTypes = v; await p.saveSettings(); }));
    toggle("Show Inbox / Calendar / Tasks", "Inbox = notes without a type, Tasks = notes with open checkboxes.", "showSmart");
    toggle("Show Files section", "Images, PDFs, videos and audio.", "showFiles");
    toggle("Show counts", "Show note counts next to each type.", "showCounts");
    new Setting(el).setName("Iconize icons")
      .setDesc("Use & sync: show Iconize's folder/file icons here and write icon changes made here back to Iconize. Ignore: use only this plugin's icons.")
      .addDropdown((d) => d.addOptions({ sync: "Use & sync", ignore: "Ignore" }).setValue(s.iconize || "sync")
        .onChange(async (v) => { s.iconize = v; await p.saveSettings(); }));
    toggle("View tabs for Bases", "Show a base's views as tabs next to the result count — for .base files and bases embedded in notes.", "viewTabs");
    toggle("Follow the open note", "When you open a note from anywhere (breadcrumbs, links, search), select its folder here.", "autoReveal");
    toggle("Open type page on click", "Clicking a type opens its .base page (all notes of that type) in the main area.", "openBaseOnClick");
    new Setting(el).setName("Folder for type pages").setDesc("Where the per-type .base files are created.")
      .addText((t) => t.setValue(s.basesFolder).setPlaceholder("Typefold")
        .onChange(async (v) => { s.basesFolder = v.trim() || "Typefold"; await p.saveSettings(false); }));
    new Setting(el).setName("Default folder for new objects")
      .addText((t) => t.setValue(s.defaultFolder).setPlaceholder("vault root")
        .onChange(async (v) => { s.defaultFolder = v.trim(); await p.saveSettings(false); }));

    new Setting(el).setName("Home").setHeading();
    new Setting(el).setName("Your name").setDesc("Used in the Home greeting.")
      .addText((t) => t.setValue(s.userName || "").onChange(async (v) => { s.userName = v.trim(); await p.saveSettings(false); }));
    toggle("Weather on Home", "Uses open-meteo.com with the location below (no account needed).", "showWeather");
    new Setting(el).setName("Weather location").setDesc("Place name, latitude, longitude")
      .addText((t) => t.setValue(s.weatherPlace || "").setPlaceholder("Seoul").onChange(async (v) => { s.weatherPlace = v.trim(); await p.saveSettings(false); }))
      .addText((t) => t.setValue(String(s.weatherLat)).onChange(async (v) => { s.weatherLat = parseFloat(v) || 0; p._wx = null; await p.saveSettings(false); }))
      .addText((t) => t.setValue(String(s.weatherLon)).onChange(async (v) => { s.weatherLon = parseFloat(v) || 0; p._wx = null; await p.saveSettings(false); }));
    toggle("Open Home on startup", "Show Home every time Obsidian starts.", "openHomeOnStartup");
    toggle("Search panel in new tabs", "A new empty tab opens a search panel to pick the page to open.", "newTabSearch");
    new Setting(el).setName("Object notes").setHeading();
    toggle("Banner image", "Show the cover / banner / image property above the title.", "showBanner");
    toggle("Related objects", "Show backlinks grouped by type as cards at the bottom of the note.", "showRelated");
    toggle("Type icons before links", "Prefix internal links with the linked note's type icon.", "linkIcons");
    new Setting(el).setName("Hide properties by default").setDesc("Click “N properties” in the status bar to show them.")
      .addToggle((t) => t.setValue(s.hideProperties).onChange(async (v) => {
        s.hideProperties = v; p.propsVisible = !v; await p.saveSettings(false); p.updateStatus();
      }));
    toggle("Capacities look", "Tinted active tab and accent links.", "themeTweaks");

    new Setting(el).setName("Companion plugins").setHeading();
    el.createEl("p", { cls: "setting-item-description", text: "Typefold works on its own. These add to it — install any you like." });
    for (const comp of COMPANIONS) {
      const installed = !!this.app.plugins?.manifests?.[comp.id];
      const enabled = !!this.app.plugins?.enabledPlugins?.has(comp.id);
      const row = new Setting(el).setName(comp.name + (comp.mine ? " ✦" : "")).setDesc(comp.why);
      if (enabled) row.addButton((b) => b.setButtonText("Enabled").setDisabled(true));
      else if (installed) row.addButton((b) => b.setButtonText("Enable").setCta().onClick(async () => { await this.app.plugins.enablePluginAndSave(comp.id); this.display(); }));
      else row.addButton((b) => b.setButtonText("Install").onClick(() => window.open(`obsidian://show-plugin?id=${comp.id}`)));
    }

    new Setting(el).setName("Developer").setHeading();
    toggle("Reload when plugin files change", "For editing this plugin: reload it automatically when main.js or styles.css change.", "devAutoReload");

    new Setting(el).setName("Types").setHeading();
    const all = [...p.index.entries()].sort((a, b) => a[1].label.localeCompare(b[1].label));
    for (const [key, entry] of all) {
      const c = s.types[key] || {};
      const row = new Setting(el).setName(`${p.labelFor(key)}`).setDesc(`${entry.files.length} notes`);
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
}

/* track this plugin's open dialogs so they can be closed properly on unload */
for (const C of [QuickOpenModal, IconColorModal, NoteIconModal, TypeConfigModal, NewTypeModal, DeleteTypeModal, TypePickerModal, BannerPickerModal]) {
  const open = C.prototype.open, close = C.prototype.close;
  C.prototype.open = function (...a) { OPEN_MODALS.add(this); return open.apply(this, a); };
  C.prototype.close = function (...a) { OPEN_MODALS.delete(this); return close.apply(this, a); };
}

module.exports = TypefoldPlugin;
