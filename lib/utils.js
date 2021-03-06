// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Thingpedia
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
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

const interpolate = require('string-interp');
const ThingTalk = require('thingtalk');

/**
  Split a textual chain of properties separated with . into an array of property names.

  Handles \ as escape character.

  @private
*/
function splitpropchain(propchainstring) {
    const chain = [];
    let buffer = '';

    let escape = false;

    const reg = /[\\.]/g;
    let match = reg.exec(propchainstring);

    let i = 0;
    while (match !== null) {
        if (match.index > i) {
            if (escape)
                escape = false;
            buffer += propchainstring.substring(i, match.index);
        }

        if (match[0] === '\\') {
            if (escape) {
                buffer += '\\';
                escape = false;
            } else {
                escape = true;
            }
        } else if (match[0] === '.') {
            if (escape) {
                buffer += '.';
                escape = false;
            } else {
                chain.push(buffer);
                buffer = '';
            }
        }

        i = reg.lastIndex;
        match = reg.exec(propchainstring);
    }

    if (i < propchainstring.length)
        buffer += propchainstring.substring(i, propchainstring.length);
    chain.push(buffer);

    return chain;
}

function get(obj, propchain) {
    for (let prop of splitpropchain(propchain))
        obj = obj[prop];
    return obj;
}

function cast(value, type) {
    if (type.isArray && typeof value === 'string')
        return value.split(/,\s*/g).map((v) => cast(v, type.elem));
    if (type.isArray)
        return value.map((v) => cast(v, type.elem));
    if (type.isDate)
        return new Date(value);
    if ((type.isNumber || type.isMeasure) && typeof value === 'string')
        return parseFloat(value);
    if (type.isCurrency && typeof value === 'number')
        return new ThingTalk.Builtin.Currency(value, 'usd');
    if (type.isCurrency && typeof value === 'string')
        return new ThingTalk.Builtin.Currency(parseFloat(value), 'usd');
    if (type.isCurrency)
        return new ThingTalk.Builtin.Currency(value.value, value.unit);
    if (type.isEntity && typeof value === 'string')
        return new ThingTalk.Builtin.Entity(value, null);
    if (type.isEntity)
        return new ThingTalk.Builtin.Entity(value.value, value.display);
    if (type.isLocation) {
        if (Object.prototype.hasOwnProperty.call(value, 'x') && Object.prototype.hasOwnProperty.call(value, 'y'))
            return new ThingTalk.Builtin.Location(value.y, value.x, value.display);
        else if (Object.prototype.hasOwnProperty.call(value, 'latitude') && Object.prototype.hasOwnProperty.call(value, 'longitude'))
            return new ThingTalk.Builtin.Location(value.latitude, value.longitude, value.display);
        else
            return new ThingTalk.Builtin.Location(value.lat, value.lon, value.display);
    }

    return value;
}

function getMixinArgs(mixin) {
    const args = {};
    for (let in_param of mixin.in_params)
        args[in_param.name] = in_param.value.toJS();
    return args;
}

function findMixinArg(mixin, arg) {
    for (let in_param of mixin.in_params) {
        if (in_param.name === arg)
            return in_param.value.toJS();
    }
    return undefined;
}

module.exports = {
    // for testing
    splitpropchain,

    getMixinArgs,
    findMixinArg,

    parseGenericResponse(json, fndef) {
        function extractOne(result) {
            let extracted = {};

            for (let argname of fndef.args) {
                const arg = fndef.getArgument(argname);
                if (arg.is_input)
                    continue;
                if (arg.annotations.json_key)
                    extracted[arg.name] = cast(get(result, arg.annotations.json_key.toJS()), arg.type);
                else
                    extracted[arg.name] = cast(result[arg.name], arg.type);
            }
            return extracted;
        }

        if (fndef.annotations.json_key)
            json = get(json, fndef.annotations.json_key.toJS());

        if (Array.isArray(json))
            return json.map(extractOne);
        else
            return [extractOne(json)];
    },

    formatString(url, deviceParams, functionParams) {
        return interpolate(url, (param) => {
            if (functionParams)
                return functionParams[param] || deviceParams[param];
            else
                return deviceParams[param];
        }, {
            failIfMissing: false
        });
    },

    getPollInterval(fndef) {
        if (fndef.annotations.poll_interval)
            return fndef.annotations.poll_interval.toJS();
        else
            return -1;
    },
};
