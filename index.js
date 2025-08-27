"use strict";

const terriaOptions = {
  baseUrl: "build/TerriaJS"
};

let _configUrl;

import ConsoleAnalytics from "terriajs/lib/Core/ConsoleAnalytics";
import GoogleAnalytics from "terriajs/lib/Core/GoogleAnalytics";
import loadJson5 from "terriajs/lib/Core/loadJson5";
import registerCatalogMembers from "terriajs/lib/Models/Catalog/registerCatalogMembers";
import registerSearchProviders from "terriajs/lib/Models/SearchProviders/registerSearchProviders";
import ShareDataService from "terriajs/lib/Models/ShareDataService";
import Terria from "terriajs/lib/Models/Terria";
import ViewState from "terriajs/lib/ReactViewModels/ViewState";
import registerCustomComponentTypes from "terriajs/lib/ReactViews/Custom/registerCustomComponentTypes";
import updateApplicationOnHashChange from "terriajs/lib/ViewModels/updateApplicationOnHashChange";
import updateApplicationOnMessageFromParentWindow from "terriajs/lib/ViewModels/updateApplicationOnMessageFromParentWindow";
import loadPlugins from "./lib/Core/loadPlugins";
import showGlobalDisclaimer from "./lib/Views/showGlobalDisclaimer";
import defined from "terriajs-cesium/Source/Core/defined";
import plugins from "./plugins";
import config from "./config.json";

// keep track of the available languages for the currnet subdomain
let _availableLanguages = ["en"];
let _siteDefaultLanguage = "en";

// we check exact match for development to reduce chances that production flag isn't set on builds(?)
if (process.env.NODE_ENV === "development") {
  terriaOptions.analytics = new ConsoleAnalytics();
} else {
  terriaOptions.analytics = new GoogleAnalytics();
}

// Construct the TerriaJS application, arrange to show errors to the user, and start it up.
const terria = new Terria(terriaOptions);

setConfigForSubdomain();

// Create the ViewState before terria.start so that errors have somewhere to go.
const viewState = new ViewState({
  terria: terria
});

// Register all types of catalog members in the core TerriaJS.  If you only want to register a subset of them
// (i.e. to reduce the size of your application if you don't actually use them all), feel free to copy a subset of
// the code in the registerCatalogMembers function here instead.
registerCatalogMembers();

// Register custom search providers in the core TerriaJS. If you only want to register a subset of them, or to add your own,
// insert your custom version of the code in the registerSearchProviders function here instead.
registerSearchProviders();

// Register custom components in the core TerriaJS.  If you only want to register a subset of them, or to add your own,
// insert your custom version of the code in the registerCustomComponentTypes function here instead.
registerCustomComponentTypes(terria);

if (process.env.NODE_ENV === "development") {
  window.viewState = viewState;
}

// If we're running in dev mode, disable the built style sheet as we'll be using the webpack style loader.
// Note that if the first stylesheet stops being nationalmap.css then this will have to change.
if (process.env.NODE_ENV !== "production" && module.hot) {
  document.styleSheets[0].disabled = true;
}

// this is to set language and reload page before bootstraping the app is completed, resulting  in a quicker page refresh without the user noticing it
const langFromUrl = new URLSearchParams(location.search).get("lang");
if (!langFromUrl) {
  const userLang = localStorage.getItem("i18nextLng");
  const params = new URLSearchParams(location.search);
  // check if user default browser language is supported by the app if not fallback to site default language if not fallback to english
  const lang = isSupportedLanguageOrDefault(userLang);
  params.set("lang", lang);
  window.location.search = params.toString();
} else if (!isSupported(langFromUrl)) {
  i18n.changeLanguage("en");
  const params = new URLSearchParams(location.search);
  params.set("lang", "en");
  window.location.search = params.toString();
}

export default terria
  .start({
    applicationUrl: window.location,
    configUrl: _configUrl,
    shareDataService: new ShareDataService({
      terria: terria
    }),
    beforeRestoreAppState: () => {
      // Load plugins before restoring app state because app state may
      // reference plugin components and catalog items.
      return loadPlugins(viewState, plugins).catch((error) => {
        console.error(`Error loading plugins`);
        console.error(error);
      });
    }
  })
  .catch(function (e) {
    terria.raiseErrorToUser(e);
  })
  .finally(function () {
    // Override the default document title with appName. Check first for default
    // title, because user might have already customized the title in
    // index.ejs
    if (document.title === "Terria Map") {
      document.title = terria.appName;
    }

    // Load init sources like init files and share links
    terria.loadInitSources().then((result) => result.raiseError(terria));

    try {
      // Automatically update Terria (load new catalogs, etc.) when the hash part of the URL changes.
      updateApplicationOnHashChange(terria, window);
      updateApplicationOnMessageFromParentWindow(terria, window);

      // Show a modal disclaimer before user can do anything else.
      if (
        defined(terria.configParameters.globalDisclaimer) &&
        terria.configParameters.globalDisclaimer.show
      ) {
        showGlobalDisclaimer(viewState);
      }

      // Add font-imports
      const fontImports = terria.configParameters.theme?.fontImports;
      if (fontImports) {
        const styleSheet = document.createElement("style");
        styleSheet.type = "text/css";
        styleSheet.innerText = fontImports;
        document.head.appendChild(styleSheet);
      }
    } catch (e) {
      console.error(e);
      console.error(e.stack);
    }
  })
  .then(() => {
    return { terria, viewState };
  });

function isSupportedLanguageOrDefault(lang) {
  const fallbackLanguage = "en";
  const isSiteDefaultLangSupported = isSupported(_siteDefaultLanguage);
  if (isSupported(lang)) {
    return lang;
  } else if (isSiteDefaultLangSupported) {
    return _siteDefaultLanguage;
  } else {
    return fallbackLanguage;
  }
}

function isSupported(lang) {
  return _availableLanguages.includes(lang);
}

function setConfigForSubdomain() {
  _configUrl = getConfigUrl();
  loadJson5(_configUrl).then(function (config) {
    document.title = config.parameters.appName;
  });
}

function getConfigUrl() {
  const url = new URL(window.location.href);
  const isProd = config.main.prod.includes(url.hostname);
  const sites = isProd ? config.sites.apps : config.sites.review;
  const paths = url.pathname.split("/").slice(1);
  const urlPath =
    paths.length !== 0
      ? paths.filter(Boolean).join("/") // This is to allow second level context paths, but first filter empty strings
      : "default";
  const _site = sites.hasOwnProperty(urlPath) ? urlPath : "default";
  const siteConfig = sites[_site];
  _availableLanguages = config.languages[_site].supportedLangs;
  _siteDefaultLanguage = config.languages[_site].defaultLang;
  const lang = getLanguage();
  const site_with_translation = loadConfig(lang, siteConfig);
  return site_with_translation;
}

function getLanguage() {
  const urlParams = new URLSearchParams(window.location.search);
  const lang = urlParams.get("lang");
  return lang;
}

function loadConfig(lang, defaultConfig) {
  const fallbackLang = "en";
  const configUrl =
    lang === fallbackLang || !lang
      ? defaultConfig
      : defaultConfig.replace(".json", `.${lang}.json`);

  return configUrl;
}
