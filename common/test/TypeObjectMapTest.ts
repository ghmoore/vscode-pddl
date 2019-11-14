/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import * as assert from 'assert';
import { TypeObjectMap } from '../src/DomainInfo';

describe('TypeObjectMap', () => {

    describe('#length', () => {
        it('empty map should be empty', () => {
            // GIVEN
            // WHEN
            let actual = new TypeObjectMap();

            // THEN
            assert.strictEqual(actual.length, 0, "size should be zero");
            assert.strictEqual(actual.getTypeOf('fictitious'), undefined, "type of undefined object");
            assert.strictEqual(actual.getTypeCaseInsensitive('fictitious'), undefined, "objects of undefined type");
        });
    });
    
    describe('#add', () => {
        it('should add one type and object', () => {
            // GIVEN
            let map = new TypeObjectMap();
            const typeName = "type1";
            const objectName = "object1";

            // WHEN
            map.add(typeName, objectName);
            map.add(typeName, objectName);// twice on purpose

            // THEN
            assert.strictEqual(map.length, 1, "size should be one");
            const object1TypeObjects = map.getTypeOf(objectName);
            assert.ok(object1TypeObjects, "there should be type for object1");
            assert.strictEqual(object1TypeObjects.type, typeName, "type name matches");
            const type1TypeObjects = map.getTypeCaseInsensitive(typeName);
            assert.ok(type1TypeObjects, "type objects for type1");
            assert.deepStrictEqual(type1TypeObjects.getObjects(), [objectName], "object names");
        });

        it('should add one type and two objects', () => {
            // GIVEN
            let map = new TypeObjectMap();
            const typeName = "type1";
            const object1Name = "object1";
            const object2Name = "object2";

            // WHEN
            map.add(typeName, object1Name);
            map.add(typeName, object2Name);

            // THEN
            assert.strictEqual(map.length, 1, "size should be one");

            const object1TypeObjects = map.getTypeOf(object1Name);
            assert.ok(object1TypeObjects, "there should be type for object1");
            assert.strictEqual(object1TypeObjects.type, typeName, "type name matches");

            const object2TypeObjects = map.getTypeOf(object2Name);
            assert.ok(object2TypeObjects, "there should be type for object2");

            const type1TypeObjects = map.getTypeCaseInsensitive(typeName);
            assert.ok(type1TypeObjects, "type objects for type1");
            assert.deepStrictEqual(type1TypeObjects.getObjects(), [object1Name, object2Name], "object names");
        });
        
        it('should add two types with one object each', () => {
            // GIVEN
            let map = new TypeObjectMap();
            const type1Name = "type1";
            const type2Name = "type2";
            const object1Name = "object1";
            const object2Name = "object2";

            // WHEN
            map.add(type1Name, object1Name);
            map.add(type2Name, object2Name);

            // THEN
            assert.strictEqual(map.length, 2, "size should be two");

            const object1TypeObjects = map.getTypeOf(object1Name);
            assert.ok(object1TypeObjects, "there should be type for object1");
            assert.strictEqual(object1TypeObjects.type, type1Name, "object1 type name matches");

            const object2TypeObjects = map.getTypeOf(object2Name);
            assert.ok(object2TypeObjects, "there should be type for object2");
            assert.strictEqual(object2TypeObjects.type, type2Name, "object2 type name matches");

            const type1TypeObjects = map.getTypeCaseInsensitive(type1Name);
            assert.ok(type1TypeObjects, "type objects for type1");
            assert.deepStrictEqual(type1TypeObjects.getObjects(), [object1Name], "object names");

            const type2TypeObjects = map.getTypeCaseInsensitive(type2Name);
            assert.ok(type2TypeObjects, "type objects for type2");
            assert.deepStrictEqual(type2TypeObjects.getObjects(), [object2Name], "object names");
        });
    });

    
    describe('#addAll', () => {
        it('should add one type and object', () => {
            // GIVEN
            let map = new TypeObjectMap();
            const typeName = "type1";
            const objectName = "object1";

            // WHEN
            map.addAll(typeName, [objectName]);
            map.addAll(typeName, [objectName]);// twice on purpose

            // THEN
            assert.strictEqual(map.length, 1, "size should be one");
            const object1TypeObjects = map.getTypeOf(objectName);
            assert.ok(object1TypeObjects, "there should be type for object1");
            assert.strictEqual(object1TypeObjects.type, typeName, "type name matches");
            const type1TypeObjects = map.getTypeCaseInsensitive(typeName);
            assert.ok(type1TypeObjects, "type objects for type1");
            assert.deepStrictEqual(type1TypeObjects.getObjects(), [objectName], "object names");
        });

        it('should add one type and two objects', () => {
            // GIVEN
            let map = new TypeObjectMap();
            const typeName = "type1";
            const object1Name = "object1";
            const object2Name = "object2";

            // WHEN
            map.addAll(typeName, [object1Name, object2Name]);

            // THEN
            assert.strictEqual(map.length, 1, "size should be one");

            const object1TypeObjects = map.getTypeOf(object1Name);
            assert.ok(object1TypeObjects, "there should be type for object1");
            assert.strictEqual(object1TypeObjects.type, typeName, "type name matches");

            const object2TypeObjects = map.getTypeOf(object2Name);
            assert.ok(object2TypeObjects, "there should be type for object2");

            const type1TypeObjects = map.getTypeCaseInsensitive(typeName);
            assert.ok(type1TypeObjects, "type objects for type1");
            assert.deepStrictEqual(type1TypeObjects.getObjects(), [object1Name, object2Name], "object names");
        });
        
        it('should add two types with one object each', () => {
            // GIVEN
            let map = new TypeObjectMap();
            const type1Name = "type1";
            const type2Name = "type2";
            const object1Name = "object1";
            const object2Name = "object2";

            // WHEN
            map.addAll(type1Name, [object1Name]);
            map.addAll(type2Name, [object2Name]);

            // THEN
            assert.strictEqual(map.length, 2, "size should be two");

            const object1TypeObjects = map.getTypeOf(object1Name);
            assert.ok(object1TypeObjects, "there should be type for object1");
            assert.strictEqual(object1TypeObjects.type, type1Name, "object1 type name matches");

            const object2TypeObjects = map.getTypeOf(object2Name);
            assert.ok(object2TypeObjects, "there should be type for object2");
            assert.strictEqual(object2TypeObjects.type, type2Name, "object2 type name matches");

            const type1TypeObjects = map.getTypeCaseInsensitive(type1Name);
            assert.ok(type1TypeObjects, "type objects for type1");
            assert.deepStrictEqual(type1TypeObjects.getObjects(), [object1Name], "object names");

            const type2TypeObjects = map.getTypeCaseInsensitive(type2Name);
            assert.ok(type2TypeObjects, "type objects for type2");
            assert.deepStrictEqual(type2TypeObjects.getObjects(), [object2Name], "object names");
        });
    });
});