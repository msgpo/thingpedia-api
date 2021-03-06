// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Thingpedia
//
// Copyright 2018 Google LLC
//           2018-2019 The Board of Trustees of the Leland Stanford Junior University
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

require('./mock');

const assert = require('assert');
const ThingTalk = require('thingtalk');
const path = require('path');

const FileClient = require('../lib/file_thingpedia_client');

const _fileClient = new FileClient({
    locale: 'en-US',

    thingpedia: path.resolve(path.dirname(module.filename), './data/thingpedia.tt'),
    entities: path.resolve(path.dirname(module.filename), './data/entities.json'),
    dataset: path.resolve(path.dirname(module.filename), './data/dataset.tt'),
});
const _schemaRetriever = new ThingTalk.SchemaRetriever(_fileClient, null, true);

async function checkValidManifest(manifest, moduleType) {
    const parsed = await ThingTalk.Grammar.parseAndTypecheck(manifest, _schemaRetriever);
    assert(parsed.isLibrary);
    assert.strictEqual(parsed.classes.length, 1);
    assert.strictEqual(parsed.datasets.length, 0);
}

async function testGetDeviceCode() {
    const nytimes = await _fileClient.getDeviceCode('com.nytimes');
    await checkValidManifest(nytimes, 'org.thingpedia.rss');

    const bing = await _fileClient.getDeviceCode('com.bing');
    await checkValidManifest(bing, 'org.thingpedia.v2');

    const test = await _fileClient.getDeviceCode('org.thingpedia.builtin.test');
    await checkValidManifest(test, 'org.thingpedia.builtin');
}

async function testGetSchemas(withMetadata) {
    const bing = await _fileClient.getSchemas(['com.bing'], withMetadata);
    const bingparsed = ThingTalk.Grammar.parse(bing);
    assert(bingparsed.isMeta);
    assert(bingparsed.classes.length >= 1);
    assert(bingparsed.classes.find((c) => c.kind === 'com.bing'));

    const multiple = await _fileClient.getSchemas(['com.bing', 'com.twitter'], withMetadata);
    const mparsed = ThingTalk.Grammar.parse(multiple);
    assert(mparsed.isMeta);
    assert(mparsed.classes.length >= 2);
    assert(mparsed.classes.find((c) => c.kind === 'com.bing'));
    assert(mparsed.classes.find((c) => c.kind === 'com.twitter'));
}

function assertNonEmptyString(what) {
    assert(typeof what === 'string' && what, 'Expected a non-empty string, got ' + what);
}

function objectEqual(o1, o2) {
    if (typeof o1 !== typeof o2)
        return false;
    if (typeof o1 !== 'object') {
        if (o1 === 'URL' && o2 === 'Entity(tt:url)')
            return true;
        if (o1 !== o2)
            console.log(o1, o2);
        return o1 === o2;
    }
    let fields = Object.keys(o1);
    for (let i = 0; i < fields.length; i++) {
        let field = fields[i];
        if (field === 'confirmation_remote' || field === 'API Endpoint URL')
            continue;
        if (!(field in o2)) {
            console.log(`missing field ${field}`);
            return false;
        }
        if (Array.isArray(o1[field]) && !arrayEqual(o1[field], o2[field]))
            return false;
        if (!objectEqual(o1[field], o2[field]))
            return false;
    }
    return true;
}

function arrayEqual(a1, a2) {
    if (!Array.isArray(a1) || !Array.isArray(a2))
        return false;
    if (a1.length !== a2.length)
        return false;
    for (let i = 0; i < a1.length; i++) {
        if (!objectEqual(a1[i], a2[i]))
            return false;
    }
    return true;
}

async function testGetExamples() {
    const all = ThingTalk.Grammar.parse(await _fileClient.getAllExamples());
    assert(all.isLibrary);
    assert.strictEqual(all.classes.length, 0);
    assert.strictEqual(all.datasets.length, 1);

    for (let ex of all.datasets[0].examples) {
        assert.deepStrictEqual(typeof ex.id, 'number');
        assert(ex.utterances.length > 0);
        ex.utterances.forEach((u) => assertNonEmptyString(u));
        assert.strictEqual(ex.utterances.length, ex.preprocessed.length);
        ex.preprocessed.forEach((p) => assertNonEmptyString(p));
    }

    const bing = ThingTalk.Grammar.parse(await _fileClient.getExamplesByKinds(['com.bing', 'com.google']));
    assert(bing.isLibrary);
    assert.strictEqual(bing.classes.length, 0);
    assert.strictEqual(bing.datasets.length, 1);

    for (let ex of bing.datasets[0].examples) {
        assert.deepStrictEqual(typeof ex.id, 'number');
        assert(ex.utterances.length > 0);
        ex.utterances.forEach((u) => assertNonEmptyString(u));
        assert.strictEqual(ex.utterances.length, ex.preprocessed.length);
        ex.preprocessed.forEach((p) => assertNonEmptyString(p));
    }
}

async function testGetEntities() {
    const all = await _fileClient.getAllEntityTypes();

    assert(Array.isArray(all));
    for (let entity of all) {
        assertNonEmptyString(entity.type);
        assertNonEmptyString(entity.name);
        // the API is not consistent on this...
        assert(typeof entity.has_ner_support === 'boolean' || typeof entity.has_ner_support === 'number');
        assert(typeof entity.is_well_known === 'boolean' || typeof entity.is_well_known === 'number');
        assert(!entity.is_well_known || entity.type.startsWith('tt:'));
    }
}

async function main() {
    await testGetDeviceCode();
    await testGetSchemas(false);
    await testGetSchemas(true);

    await testGetExamples();
    await testGetEntities();
}

module.exports = main;
if (!module.parent)
    main();
