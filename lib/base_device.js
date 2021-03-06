// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Thingpedia
//
// Copyright 2016-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const events = require('events');
const Url = require('url');
const interpolate = require('string-interp');

/**
 * The coarse grain classification of the currently running Almond platform.
 *
 * Tiers are used to inform how synchronization of device database occurs.
 *
 * @alias BaseDevice.Tier
 * @enum {string}
 */
const Tier = {
    GLOBAL: 'global',
    PHONE: 'phone',
    SERVER: 'server',
    DESKTOP: 'desktop',
    CLOUD: 'cloud'
};

/**
 * Whether a device is available (power on and accessible).
 *
 * @alias BaseDevice.Availability
 * @enum {number}
 */
const Availability = {
    UNAVAILABLE: 0,
    AVAILABLE: 1,
    OWNER_UNAVAILABLE: 2,
    UNKNOWN: -1
};

/**
 * The base class of all Thingpedia device implementations.
 *
 * @extends events.EventEmitter
 */
class BaseDevice extends events.EventEmitter {
    /**
     * Construct a new Thingpedia device.
     *
     * You should never construct a BaseDevice directly. Only subclasses should
     * call the constructor.
     *
     * @param {BaseEngine} engine - the shared Almond engine initializing this device
     * @param {Object} state - arbitrary JSON data associated with this device
     * @protected
     */
    constructor(engine, state) {
        super();
        this._engine = engine;

        /**
         * The current device state.
         *
         * @readonly
         * @type {Object}
         */
        this.state = state;

        // provide default uniqueId for config.none() devices
        const ast = this.metadata;
        const params = Object.keys(ast.params);
        const isNoneFactory = ast.auth.type === 'none' && params.length === 0;
        const isNoneAuth = ast.auth.type === 'none';

        /**
         * The unique ID of this device instance.
         *
         * Device implementations should set this the Thingpedia kind (class ID) plus something unique
         * (eg "com.mydevice/aa-bb-cc-dd-ee-ff") so that no other device
         * can possibly have the same ID.
         * If you leave it unset, a unique identifier will be automatically generated.
         *
         * @name BaseDevice#uniqueId
         * @type {string}
         * @member
         */
        if (isNoneFactory)
            this.uniqueId = this.kind;
        else if (isNoneAuth)
            this.uniqueId = this.kind + '-' + params.map((k) => (k + ':' + state[k])).join('-');
        else
            this.uniqueId = undefined; // let DeviceDatabase pick something

        // provide default name and description
        // NOTE: these are not getters, because the subclass can override
        // them and mutate them as it wishes

        /**
         * The user-visible name of this device instance.
         *
         * If multiple instances of the same class can reasonably be configured by the same
         * user (e.g. multiple devices of the same brand, or multiple accounts on the same service),
         * they should have different names.
         *
         * This defaults to the name provided in Thingpedia, with placeholders replaced with
         * values taken from the device state.
         *
         * @type {string}
         */
        this.name = ast.name;
        if (ast.name) {
            this.name = interpolate(ast.name, this.state, {
                locale: this.platform.locale,
                timezone: this.platform.timezone
            });
        }

        /**
         * A longer description of this device instance.
         *
         * This can be used to add additional distinguishing information, such as the URL
         * or address of a local gateway.
         * It defaults to the description provided in Thingpedia.
         *
         * @type {string}
         */
        this.description = ast.description;
        if (ast.description) {
            this.description = interpolate(ast.description, this.state, {
                locale: this.platform.locale,
                timezone: this.platform.timezone
            });
        }

        /**
         * Discovery protocol descriptors.
         *
         * Device implementations should set these to protocol/discovery specific IDs (such as
         * "bluetooth/aa-bb-cc-dd-ee-ff") so that it is unlikely that
         * another device has the same ID.
         *
         * @type {string[]}
         */
        this.descriptors = [];

        /**
         * Indicates a transient device.
         *
         * Set to true if this device should not be stored in the device database
         * but only kept in memory (i.e., its lifetime is managed by some
         * device discovery module, or it's a subdevice of some other device).
         *
         * @type {boolean}
         */
        this.isTransient = false;

        this._ownerTier = undefined;
    }

    // configuration interfaces

    /**
     * Begin configuring this device using a custom OAuth-like flow.
     *
     * This includes OAuth 1.0 and OAuth 2.0 with custom code.
     * Standard uses of OAuth 2.0 should not override this method. Instead, they
     * should use the `@org.thingpedia.config.oauth2()` mixin, and override {@link BaseDevice.loadFromOAuth2}.
     *
     * The method should return a tuple of:
     * - redirect uri (a String)
     * - session object (a plain JS object mapping String to String)
     *
     * The data in the session object will be passed to `completeCustomOAuth`.
     *
     * @param {BaseEngine} engine - the shared Almond engine initializing this device
     * @return {Array} tuple of redirect URI and session data
     * @abstract
    */
    static async loadFromCustomOAuth(engine) {
        // if not overridden, call the compatibility method using the legacy interface
        // (req === null to mean phase1, req !== null for phase2)
        // NOTE: we're in a static method, so "this" refers to the class, not the instance!
        return this.runOAuth2(engine, null);
    }

    /**
     * Complete configuring this device using custom OAuth-like flows.
     *
     * This method will be called after the user redirects back to Almond,
     * and will be passed the redirect URL, and the session information that was returned
     * by {@link BaseDevice.loadFromCustomOAuth}.
     *
     * @param {BaseEngine} engine - the shared Almond engine initializing this device
     * @param {string} url - the redirect URL called after completing OAuth
     * @param {Object.<string,string>} session - session data that was returned from {@link BaseDevice.loadFromCustomOAuth}
     * @return {BaseDevice} the fully configured device instance
     * @abstract
    */
    static async completeCustomOAuth(engine, url, session) {
        // if not overridden, call the compatibility method with a made-up `req` object
        const req = {
            httpVersion: '1.0',
            headers: [],
            rawHeaders: [],
            method: 'GET',
            url: url,
            query: Url.parse(url, true).query,
            session: session
        };
        return this.runOAuth2(engine, req);
    }

    /* istanbul ignore next */
    /**
     * Configure this device using OAuth 2.0
     *
     * This method is called by the OAuth 2.0 helpers (`@org.thingpedia.config.oauth2()`)
     * and should return a new device instance.
     *
     * @param {BaseEngine} engine - the shared Almond engine initializing this device
     * @param {string} accessToken - the OAuth access token
     * @param {string} [refreshToken] - the OAuth refresh token, if one is provided
     * @param {Object} extraData - the whole response to the OAuth token request
     * @abstract
    */
    static async loadFromOAuth2(engine, accessToken, refreshToken, extraData) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    /**
     * Configure this device using local discovery.
     *
     * The method should return a new device instance. The instance might be partially
     * initialized (e.g. for Bluetooth, the device might not be paired). If the user
     * chooses to continue configuring the device, {@link BaseDevice#completeDiscovery} will be called.
     *
     * @param {BaseEngine} engine - the shared Almond engine initializing this device
     * @param {Object} publicData - protocol specific data that is public (e.g. Bluetooth UUIDs)
     * @param {Object} privateData - protocol specific data that is specific to the device and
     *                               private to the user (e.g. Bluetooth HW address)
     * @return {BaseDevice} the new, partially initialized device instance
     * @abstract
    */
    static async loadFromDiscovery(engine, publicData, privateData) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    /**
     * Complete configuring this device from local discovery.
     *
     * The implementation should use the passed delegate to interact with the user, for
     * example to have the user enter or confirm a PIN code shown on the device, or have
     * the user press a physical button on the device.
     *
     * Note this is an instance method, not a static method. It will be called
     * on the partially initialized instance returned by {@link BaseDevice.loadFromDiscovery}.
     *
     *
     * @param {ConfigDelegate} delegate - a delegate object to interact with the user and complete configuration
     * @return {BaseDevice} the device instance itself (`this`)
     * @abstract
    */
    async completeDiscovery(delegate) {
        throw new Error('not implemented');
    }

    /* istanbul ignore next */
    /**
     * Update the device state based on local discovery data.
     *
     * @param {Object} privateData - protocol specific data that is specific to the device and
     *                               private to the user (e.g. Bluetooth HW address)
     */
    async updateFromDiscovery(privateData) {
        // nothing to do here, subclasses can override if they support discovery
    }

    /**
     * Update the device state when the OAuth 2.0 token is refreshed.
     *
     * The default implementation will store the new access token and refresh token,
     * and ignore other fields.
     *
     * @param {string} accessToken - the new access token
     * @param {string} [refreshToken] - the new refresh token, if one is provided
     * @param {Object} extraData - the whole response to the OAuth token request
     */
    async updateOAuth2Token(accessToken, refreshToken, extraData) {
        this.state.accessToken = accessToken;
        // if the refresh token is single use, we will get a new one when we use it
        if (refreshToken)
            this.state.refreshToken = refreshToken;

        this.stateChanged();
    }

    /* istanbul ignore next */
    /**
     * Configure this device using interactive (voice-based) configuration.
     *
     * The implementation should use the passed delegate to interact with the user, for
     * example to have the user enter a password or answer a question.
     *
     * @param {BaseEngine} engine - the shared Almond engine initializing this device
     * @param {ConfigDelegate} delegate - a delegate object to interact with the user and complete configuration
     * @return {BaseDevice} the fully configured device instance
     * @abstract
     */
    static async loadInteractively(engine, delegate) {
        // if not overridden, call the compatibility method
        // NOTE: we're in a static method, so "this" refers to the class, not the instance!
        return this.configureFromAlmond(engine, delegate);
    }

    /**
     * The Thingpedia "kind" (unique class ID) of this device.
     *
     * @type string
     * @readonly
     */
    get kind() {
        return this.state.kind;
    }

    // obsolete, do not use
    get metadata() {
        return this.constructor.metadata;
    }

    /**
     * Access the current platform for this device instance.
     *
     * @type {BasePlatform}
     * @readonly
     */
    get platform() {
        return this._engine.platform;
    }

    /**
     * Access the current engine for this device instance.
     *
     * @type {BaseEngine}
     * @readonly
     * @deprecated It is recommended to avoid using the {@link BaseEngine} API as it can change without notice.
     */
    get engine() {
        console.log('BaseDevice.engine is deprecated and should not be used in new code.');
        return this._engine;
    }

    /**
     * Notify that the device's serialized state changed.
     *
     * This should be called after any change to {@link BaseDevice#state} meant to be
     * persisted on disk.
     *
     * @fires BaseDevice#state-changed
     * @protected
     */
    stateChanged() {
        /**
         * Reports a change in device state.
         *
         * @event BaseDevice#state-changed
         */
        this.emit('state-changed');
    }

    /**
     * Replace the current serialized state of the device.
     *
     * This method is called by Almond as part of the device synchronization logic.
     * It can also be called by device implementations if the state changes outside of the class.
     *
     * @param {Object} state - the new state
     */
    updateState(state) {
        // nothing to do here by default, except for updating the state
        // pointer
        // subclasses can override if they need to do anything about it
        this.state = state;
    }

    /**
     * Serialize the device to disk
     *
     * @return {Object} the serialized device representation
     */
    serialize() {
        if (!this.state)
            throw new Error('Device lost state, cannot serialize');
        return this.state;
    }

    /* istanbul ignore next */
    /**
     * Start a device.
     *
     * This method will be called when the device is loaded (after configuration
     * or when the engine is restarted).
     */
    async start() {
        // nothing to do here, subclasses can override if they need to
    }

    /* istanbul ignore next */
    /**
     * Stop a device.
     *
     * This method will be called when the device is unloaded, either because the
     * user removed it or because the engine is terminating.
     */
    async stop() {
        // nothing to do here, subclasses can override if they need to
    }


    // Obsolete, ignore
    get ownerTier() {
        return Tier.GLOBAL;
    }

    /**
     * Perform an async check to verify if the device is available
     * (i.e., on, working, reachable on the local network, etc.)
     *
     * @returns {BaseDevice.Availability} whether the device is available or not.
     */
    async checkAvailable() {
        return Availability.UNKNOWN;
    }

    /**
     * Check if this device implements the given Thingpedia kind.
     *
     * A device can have multiple kinds at the same time.
     *
     * You should not override this function. Instead, you should mark your
     * ThingTalk class as extending another ThingTalk class.
     * If you do override it, you must chain up to handle the default kinds.
     *
     * @param {string} kind - the Thingpedia kind to check
     * @return {boolean} whether the device implements this interface or not
     */
    hasKind(kind) {
        if (kind === 'data-source')
            return this.constructor.metadata.category === 'data';
        if (kind === 'online-account')
            return this.constructor.metadata.category === 'online';
        if (kind === 'thingengine-system')
            return this.constructor.metadata.category === 'system';

        return kind === this.kind ||
            (this.constructor.metadata.types.indexOf(kind) >= 0);
    }

    /* istanbul ignore next */
    /**
     * Request an extension interface for this device.
     *
     * Extension interfaces allow to provide additional device and
     * vendor specific capabilities that do not map to ThingTalk functions.
     * If the interface is not recognized this method returns null
     * (up to the caller to check it or just use it blindly and explode).
     *
     * Note that all method calls on the interface might fail if
     * the device is not available (but are not required to).
     * Also note that this method might return null if the device
     * exists but not locally (e.g., it's a bluetooth device but we're
     * running on a cloud platform).
     *
     * Well-known extension interfaces are "subdevices" (for device
     * collections) and "messaging" (for the messaging system)
     *
     * @param {string} name - the interface name
     * @return {any} the extension implementation
     */
    queryInterface(name) {
        // no extension interfaces for this device class
        return null;
    }
}
// no $rpc for queryInterface, extension interfaces are not exported
BaseDevice.prototype.$rpcMethods = [
    'get name', 'get uniqueId', 'get description',
    'get ownerTier', 'get kind', 'get isTransient',
    'checkAvailable', 'hasKind'];

module.exports = BaseDevice;
module.exports.Availability = Availability;
module.exports.Tier = Tier;
