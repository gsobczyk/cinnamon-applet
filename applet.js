/*
 * Simple Hamster applet for Cinnamon
 * Copyright (c) 2013 Jon Brett <jonbrett.dev@gmail.com>
 *
 * Based on the Hamster Gnome shell extension
 * Copyright (c) 2011 Jerome Oufella <jerome@oufella.com>
 * Copyright (c) 2011-2012 Toms Baugis <toms.baugis@gmail.com>
 * Icons Artwork Copyright (c) 2012 Reda Lazri <the.red.shortcut@gmail.com>
 *
 * Portions originate from the gnome-shell source code, Copyright (c)
 * its respectives authors.
 * This project is released under the GNU GPL License.
 * See COPYING for details.
 *
 */

 const AppletUUID = "hamster@projecthamster.wordpress.com";

 const Applet = imports.ui.applet;
 const Clutter = imports.gi.Clutter;
 const GLib = imports.gi.GLib;
 const Gtk = imports.gi.Gtk;
 const Lang = imports.lang;
 const Slider = imports.ui.slider;
 const St = imports.gi.St;
 const Main = imports.ui.main;
 const Gio = imports.gi.Gio;
 const PopupMenu = imports.ui.popupMenu;
 const Gettext = imports.gettext;
 const _ = Gettext.gettext;
 
 const KEYPAD_MINUS = 65453;
 const KEYPAD_PLUS = 65451;
 const MAX_BACK_START = 180;
 const BACK_START_STEP = 5;
 const SLIDER_STEP = BACK_START_STEP / MAX_BACK_START;
 const MAX_SUGGESTIONS = 50;

 /* Local imports */
 const AppletDir = imports.ui.appletManager.appletMeta[AppletUUID].path;
 imports.searchPath.unshift(AppletDir);
 const Stuff = imports.stuff;
 const Convenience = imports.convenience;

// dbus-send --session --type=method_call --print-reply --dest=org.gnome.Hamster /org/gnome/Hamster org.freedesktop.DBus.Introspectable.Introspect
const ApiProxyIface = '<node> \
<interface name="org.gnome.Hamster"> \
<method name="GetTodaysFacts"> \
<arg direction="out" type="a(iiissisasiib)" /> \
</method> \
<method name="StopTracking"> \
<arg direction="in"  type="v" name="end_time" /> \
</method> \
<method name="AddFact"> \
<arg direction="in"  type="s" name="fact" /> \
<arg direction="in"  type="i" name="start_time" /> \
<arg direction="in"  type="i" name="end_time" /> \
<arg direction="in"  type="b" name="temporary" /> \
<arg direction="out" type="i" /> \
</method> \
<method name="GetFacts"> \
<arg direction="in"  type="u" name="start_date" /> \
<arg direction="in"  type="u" name="end_date" /> \
<arg direction="in"  type="s" name="search_terms" /> \
<arg direction="in"  type="u" name="limit" /> \
<arg direction="in"  type="b" name="asc_by_date" /> \
<arg direction="out" type="a(iiissisasiib)" /> \
</method> \
<method name="GetActivities"> \
<arg direction="in"  type="s" name="search" /> \
<arg direction="out" type="a(ss)" /> \
</method> \
<method name="GetExtActivities"> \
<arg direction="in"  type="s" name="search" /> \
<arg direction="out" type="a(ss)" /> \
</method> \
<method name="GetCategories"> \
<arg direction="out" type="a(is)" /> \
</method> \
<signal name="FactsChanged"></signal> \
<signal name="ActivitiesChanged"></signal> \
<signal name="TagsChanged"></signal> \
</interface> \
</node>';

let ApiProxy = Gio.DBusProxy.makeProxyWrapper(ApiProxyIface);

// dbus-send --session --type=method_call --print-reply --dest=org.gnome.Hamster.WindowServer /org/gnome/Hamster/WindowServer org.freedesktop.DBus.Introspectable.Introspect
const WindowsProxyIface = '<node> \
<interface name="org.gnome.Hamster.WindowServer"> \
<method name="edit"> \
<arg direction="in"  type="v" name="id" /> \
</method> \
<method name="overview"></method> \
<method name="preferences"></method> \
</interface> \
</node>';

let WindowsProxy = Gio.DBusProxy.makeProxyWrapper(WindowsProxyIface);



/* a little box or something */
function HamsterBox() {
    this._init.apply(this, arguments);
}

HamsterBox.prototype = {
    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(suggestionsGroup, itemParams) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, {reactive: false});

        this.suggestionsGroup = suggestionsGroup;
        let box = new St.BoxLayout();
        box.set_vertical(true);

        let label = new St.Label({style_class: 'popup-menu-content popup-subtitle-menu-item'});
        label.set_text(_("What are you doing?"))
        box.add(label);

        this._textEntry = new St.Entry({name: 'searchEntry',
            can_focus: true,
            track_hover: false,
            hint_text: _("Enter activity..."),
            style_class: 'popup-menu-item',
            style: 'selected-color: black;'});
        // this._textEntry.clutter_text.connect('activate', Lang.bind(this, this._onEntryActivated));
        this._textEntry.clutter_text.connect('key-release-event', Lang.bind(this, this._onKeyReleaseEvent));

        box.add(this._textEntry);

        this.addActor(box, {expand:true, span: -1});

        this.autocompleteActivities = [];
        this.runningActivitiesQuery = null;

        this._prevText = "";
    },

    // _onEntryActivated: function() {
    //     this.emit('activate');
    //     this._textEntry.set_text('');
    // },

    focus: function() {
        global.stage.set_key_focus(this._textEntry);
    },

    blur: function() {
        global.stage.set_key_focus(null);
    },

    _getActivitiesAndFillSuggestions: function(activitytext) {
        if (this.runningActivitiesQuery){
            return this.autocompleteActivities;
        }

        this.suggestionsGroup.setSensitive(false);
        this.suggestionsGroup.menu.box.get_children().forEach(function(c) {
            c.destroy()
        });

        this.runningActivitiesQuery = true;
        this.proxy.GetExtActivitiesRemote(activitytext, Lang.bind(this, function([response], err) {
            this.runningActivitiesQuery = false;
            this.autocompleteActivities = response;
            this._fillSuggestions([response]);
        }));

        return this.autocompleteActivities;
    },

    _fillSuggestions: function([activities]) {
        // global.log("fill suggestions start, length: " + activities.length);
        for (var i=0; i < activities.length && i < MAX_SUGGESTIONS; i++){
            let fact = Stuff.activityToFact([activities[i]]);
            let factStr = Stuff.factToStr(fact);
            let factItem = new FactPopupMenuItem(fact);
            this.suggestionsGroup.menu.addMenuItem(factItem);
            // global.log("activity: %s".format(factStr));
        }
        // global.log("fill suggestions end");
        if (activities.length>0) {
            this.suggestionsGroup.setSensitive(true);
            this.suggestionsGroup.activate(false);
        } else {
            this.suggestionsGroup.close(true);
            this.suggestionsGroup.setSensitive(false);
        }
    },

    _onKeyReleaseEvent: function(textItem, evt) {
        let symbol = evt.get_key_symbol();
        let text = this._textEntry.get_text().toLowerCase();

        // ignore deletions
        let ignoreKeys = [Clutter.BackSpace, Clutter.Delete, Clutter.Escape]
        for each (var key in ignoreKeys) {
            if (symbol == key)
                return;
        }
        
        this._getActivitiesAndFillSuggestions(text);

    }
};

function HamsterApplet(metadata, orientation, panel_height) {
    this._init(metadata, orientation, panel_height);
}

HamsterApplet.prototype = {
    __proto__: Applet.TextIconApplet.prototype,

    _init: function(metadata, orientation, panel_height) {
        Applet.TextIconApplet.prototype._init.call(this, orientation, panel_height);

        this._proxy = new ApiProxy(Gio.DBus.session, 'org.gnome.Hamster', '/org/gnome/Hamster');
        this._proxy.connectSignal('FactsChanged',      Lang.bind(this, this.refresh));
        this._proxy.connectSignal('ActivitiesChanged', Lang.bind(this, this.refreshActivities));
        this._proxy.connectSignal('TagsChanged',       Lang.bind(this, this.refresh));


        this._windowsProxy = new WindowsProxy(Gio.DBus.session,
          "org.gnome.Hamster.WindowServer",
          "/org/gnome/Hamster/WindowServer");

        this._settings = Convenience.getSettings();
        this.path = metadata.path;

        // Set initial label, icon, activity
        this._label = _("Loading...");
        this.set_applet_label(this._label);

        Gtk.IconTheme.get_default().append_search_path(metadata.path + "/images/");
        this._trackingIcon = "hamster-tracking";
        this._idleIcon = "hamster-idle";
        this.set_applet_icon_symbolic_name("hamster-tracking");

        this.currentActivity = null;

        // Create applet menu
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuOpen = false;
        this.menuManager.addMenu(this.menu);

        // Add HamsterBox to menu
        this.suggestions = new PopupMenu.PopupSubMenuMenuItem(_("Suggestions"));
        let item = new HamsterBox(this.suggestions);
        // item.connect('activate', Lang.bind(this, this._onActivityEntry));
        this.activityEntry = item;
        this.activityEntry.proxy = this._proxy; // lazy proxying
        this.menu.addMenuItem(item);

        this.suggestions.setSensitive(false);
        this.menu.addMenuItem(this.suggestions);

        this.recentActivities = new PopupMenu.PopupSubMenuMenuItem(_("Recent activities"));
        this.menu.addMenuItem(this.recentActivities);

        // overview
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        item = new PopupMenu.PopupMenuItem(_("Show Overview"));
        item.connect('activate', Lang.bind(this, this._onShowHamsterActivate));
        this.menu.addMenuItem(item);

        // stop tracking
        item = new PopupMenu.PopupMenuItem(_("Stop Tracking"));
        item.connect('activate', Lang.bind(this, this._onStopTracking));
        this.menu.addMenuItem(item);

        // add new task
        item = new PopupMenu.PopupMenuItem(_("Add Earlier Activity"));
        item.connect('activate', Lang.bind(this, this._onNewFact));
        this.menu.addMenuItem(item);

        // settings
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        item = new PopupMenu.PopupMenuItem(_("Tracking Settings"));
        item.connect('activate', Lang.bind(this, this._onShowSettingsActivate));
        this.menu.addMenuItem(item);

        // applet settings
        item = new PopupMenu.PopupMenuItem(_("Applet Settings"));
        item.connect('activate', Lang.bind(this, this._onAppletSettingsActivate));
        this.menu.addMenuItem(item);

        // focus menu upon display
        this.menu.connect('open-state-changed', Lang.bind(this,
            function(menu, open) {
                if (open) {
                    this.menuOpen = true;
                    this.activityEntry.focus();
                } else {
                    this.menuOpen = false;
                    this.activityEntry.blur();
                }
            }
        ));

        // Add global hotkey (works in Cinnamon >= 1.8)
        this.hotkey = "" + this._settings.get_strv("show-hamster-dropdown");
        try {
            Main.keybindingManager.addHotKey("show-hamster-menu",
                this.hotkey,
                Lang.bind(this, this.on_hotkey_triggered));
        } catch (e) {
            global.logError(e);
        }

        // load data
        this.facts = null;
        // refresh the label every 30 secs
        this.timeout = GLib.timeout_add_seconds(0, 30, Lang.bind(this, this.refresh));
        this.refresh();
    },

    on_applet_clicked: function(event) {
        this.menu.toggle();
        let text = this.activityEntry._textEntry.set_text('');
    },

    on_hotkey_triggered: function() {
        this.menu.toggle();
        let text = this.activityEntry._textEntry.set_text('');
    },

    refreshActivities: function(proxy, sender) {
        this.activityEntry.autocompleteActivities = [];
        this.refresh();
    },

    refresh: function(proxy, sender) {
        if (!this.menuOpen){
            this._proxy.GetTodaysFactsRemote(Lang.bind(this, this._refreshRecent));
        } else {
            global.log("skipping refresh - menu is open");
        }
        return true;
    },

    _refreshRecent: function([todayFacts], err) {
        let startDate = Stuff.epochSecondsMinusDays(7);
        let endDate = Stuff.epochSeconds();
        let search = "";
        let limit = 30;
        let ascByDate = false;
        // var todayResp = todayFacts;
        this._proxy.GetFactsRemote(startDate, endDate, search, limit, ascByDate, Lang.bind(this, function([recentFacts], err) {
            // global.log("retrieved " + recentFacts.length + " facts");
            this._refresh([recentFacts], [todayFacts], err);
        }));
        return true;
    },

    _refresh: function([recentFactsResp], [todayFactsResp], err) {
        let facts = [];
        let recentFacts = [];

        if (err) {
            log(err);
        } 
        if (todayFactsResp.length > 0) {
            facts = Stuff.fromDbusFacts(todayFactsResp);
        }
        if (recentFactsResp.length > 0) {
            recentFacts = Stuff.fromDbusFacts(recentFactsResp);
        }
        // global.log("passed: %s today and %s recent facts".format(todayFactsResp.length, recentFactsResp.length));
        // global.log("converted: %s today and %s recent facts".format(facts.length, recentFacts.length));

        this.currentActivity = null;
        let currentActivityStr = "";
        let fact = null;
        if (facts.length) {
            fact = facts[facts.length - 1];
            if (!fact.endTime) {
                this.currentActivity = fact;
                currentActivityStr = Stuff.factToStr(fact);
            }
        }

        let today_duration = 0;
        for each (var fact in facts) {
            today_duration += fact.delta;
        }

        this.updatePanelDisplay(fact, today_duration);

        this.recentActivities.menu.box.get_children().forEach(function(c) {
            c.destroy()
        });

        // ------------------RECENT
        let byCategoryRecent = {};
        let categoriesRecent = [];
        let recentFactsStr = [];
        // global.log("grouping facts, size: " + recentFacts.length);
        for each (var fact in recentFacts) {
            if (categoriesRecent.indexOf(fact.category) == -1){
                categoriesRecent.push(fact.category);
                byCategoryRecent[fact.category] = [];
            }
            let factStr = Stuff.factToStr(fact);
            if (recentFactsStr.indexOf(factStr) == -1 && currentActivityStr != factStr){
                recentFactsStr.push(factStr);
                byCategoryRecent[fact.category].push(fact);
            }
        }

        for each (var category in categoriesRecent) {
            this.recentActivities.menu.addActor(new St.Label({text: category, style_class: 'recent-group'}));
            for each (var fact in byCategoryRecent[category]) {
                // global.log("preparing menu item for fact: " + fact.name);
                let recent = new FactPopupMenuItem(fact, {style_class: 'recent-item'});
                this.recentActivities.menu.addMenuItem(recent);
            }
        }
    },


    updatePanelDisplay: function(fact, today_duration) {
        // 0 = show label, 1 = show icon + duration, 2 = just icon
        let appearance = this._settings.get_int("panel-appearance");

        /* Format label strings and icon */
        if (fact && !fact.endTime) {
            this._label_short = Stuff.formatDuration(fact.delta) + " / " + Stuff.formatDuration(today_duration);
            this._label_long = this._label_short + " " + fact.name;
            this._icon_name = "hamster-tracking";
        } else {
            this._label_short = _("No Activity");
            this._label_long = this._label_short;
            this._icon_name = "hamster-idle";
        }

        /* Configure based on appearance setting */
        if (appearance == 0) {
            this.set_applet_icon_symbolic_name("none");
            this.set_applet_label(Stuff.shortenLabel(this._label_long));
        } else if (appearance == 1) {
            this.set_applet_icon_symbolic_name(this._icon_name);
            this.set_applet_label(Stuff.shortenLabel(this._label_short));
        } else {
            this.set_applet_icon_symbolic_name(this._icon_name);
            this.set_applet_label("");
        }
        this.set_applet_tooltip(this._label_long);
    },


    _onStopTracking: function() {
        this._proxy.StopTrackingRemote(GLib.Variant.new('i', [Stuff.epochSeconds()]));
    },

    _onShowHamsterActivate: function() {
        this._windowsProxy.overviewSync();
    },

    _onNewFact: function() {
        this._windowsProxy.editSync(GLib.Variant.new('i', [0]));
    },

    _onShowSettingsActivate: function() {
        this._windowsProxy.preferencesSync();
    },

    _onAppletSettingsActivate: function() {
        GLib.spawn_command_line_async(this.path + '/prefs.js');
    }

    // _onActivityEntry: function() {
    //     let text = this.activityEntry._textEntry.get_text();
    //     this._proxy.AddFactRemote(text, 0, 0, false, Lang.bind(this, function(response, err) {
    //         // not interested in the new id - this shuts up the warning
    //     }));
    // }
};



function FactPopupMenuItem() {
 this._init.apply(this, arguments);
}

FactPopupMenuItem.prototype = {

    __proto__: PopupMenu.PopupBaseMenuItem.prototype,

    _init: function(fact, params) {
        PopupMenu.PopupBaseMenuItem.prototype._init.call(this, params);
        this.fact = fact;
        this.backStart = 0;
        this._proxy = new ApiProxy(Gio.DBus.session, 'org.gnome.Hamster', '/org/gnome/Hamster');

        this.factNameLabel = new St.Label({ text: this._generateFactLabel(), style_class: 'fact-name'})
        let factTags = (0 < fact.tags.length ? ("#" + fact.tags.join(", #")) : "")
        let factTagsLabel = new St.Label({ text: " " + factTags, style_class: 'tags'})
        let time = "";
        if (fact.startTime) {
            let time = "(%02d.%02d %02d:%02d)".format(fact.startTime.getDate(), fact.startTime.getMonth(), fact.startTime.getHours(), fact.startTime.getMinutes());
        }
        let timeLabel = new St.Label({ text: " " + time});

        this.addActor(this.factNameLabel);
        this.addActor(factTagsLabel, {align: St.Align.END});
        this.addActor(timeLabel);

        this.slider = new Slider.Slider(1);//only for range fix (from 0 to 1)
        // this.addActor(this.slider.actor);

        this.connect('activate', Lang.bind(this, this._onStartActivity));
        this.actor.connect('key-press-event', Lang.bind(this, this._onKeyPressEvent));
        this.actor.connect('scroll-event', Lang.bind(this, this._onScrollEvent));
        this.slider.connect('value-changed', Lang.bind(this, this._sliderChanged));
    },

    _onScrollEvent: function (actor, event) {
        let direction = event.get_scroll_direction();
        // global.log("sroll");
        if (direction == Clutter.ScrollDirection.DOWN) {
            this._modifySliderValue(-SLIDER_STEP);
        }
        else if (direction == Clutter.ScrollDirection.UP) {
            this._modifySliderValue(SLIDER_STEP);
        }
        // global.log("slider value is set");
    },

    _modifySliderValue: function(delta) {
        // global.log("delta: " + delta);
        this.slider.setValue(this.slider._value + delta);
        this._sliderChanged(this.slider, this.slider._value);
    },

    _onStartActivity: function (actor, event) {
        let factStr = Stuff.factToStr(this.fact);
        global.log(factStr + " - start: " + Stuff.epochSeconds());
        this._proxy.AddFactRemote(factStr, Stuff.epochSeconds() - this.backStart * 60, 0, false, Lang.bind(this, function(response, err) {
            // not interested in the new id - this shuts up the warning
        }));
        // this.menu.close();
    },

    _onKeyPressEvent: function(actor, evt) {
        let symbol = evt.get_key_symbol();
        // global.log("key: " + symbol);
        if (symbol == Clutter.plus || symbol == Clutter.equal || symbol == KEYPAD_PLUS || symbol == Clutter.Page_Up) {
            this._modifySliderValue(SLIDER_STEP);
            // global.log("up");
            return Clutter.EVENT_STOP;
        } else if (symbol == Clutter.minus || symbol == Clutter.underscore || symbol == KEYPAD_MINUS || symbol == Clutter.Page_Down) {
            this._modifySliderValue(-SLIDER_STEP);
            // global.log("down");
            return Clutter.EVENT_STOP;
        } else if (symbol == Clutter.KEY_space || symbol == Clutter.KEY_Return) {
            this.activate(evt);
            // this._onStartActivity(actor, evt);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    },

    _generateFactLabel: function(){
        let prefix = "";
        if (this.backStart > 0) {
            let before = new Date();
            before.setMinutes(before.getMinutes() - this.backStart);
            // prefix = "-" + this.backStart + "min ";
            prefix = "-%smin: %02d:%02d ".format(this.backStart, before.getHours(), before.getMinutes());
        }
        return prefix + this.fact.name;
    },

    _sliderChanged: function(slider, value) {
        this.backStart = Math.round((1 - value) * MAX_BACK_START);
        this.factNameLabel.set_text(this._generateFactLabel());
    }
};

function main(metadata, orientation, panel_height) {
    /* Use local translations
    * TODO: Update translations to make them specific to this applet */
    Gettext.bindtextdomain("hamster-shell-extension", metadata.path + "/locale");
    Gettext.textdomain("hamster-shell-extension");
    return new HamsterApplet(metadata, orientation, panel_height);
}
