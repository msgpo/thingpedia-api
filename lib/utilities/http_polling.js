// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Shloka Desai <shloka@stanford.edu>
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const lang = require('../lang');
const BaseChannel = require('../base_channel');
const Helpers = require('../helpers');
const PollingTrigger = require('./polling');

module.exports = new lang.Class({
    Name: 'HttpPollingTrigger',
    Extends: PollingTrigger,

    // must set (or have accessors for)
    // this.url, this.userAgent, this.auth or this.useOAuth2

    _onResponse: function() {
        throw new Error('Must override onResponse for a HttpPollingTrigger');
    },

    _onTick: function() {
        return Helpers.Http.get(this.url, { auth: this.auth, useOAuth2: this.useOAuth2, 'user-agent': this.userAgent }).then(function(response) {
            return this._onResponse(response);
        }.bind(this)).catch(function(error) {
            console.error('Error reading from upstream server: ' + error.message);
            console.error(error.stack);
        });
    },
});