import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isbn13,norm,stableBookKey } from '../src/bookKnowledge/identity';
test('normalizes accents and punctuation',()=>assert.equal(norm('Café—Books!'),'cafe books'));
test('accepts valid ISBN-13 and rejects bad check digit',()=>{assert.equal(isbn13('9780306406157'),'9780306406157');assert.equal(isbn13('9780306406158'),null);});
test('same title and authors stable regardless author order',()=>assert.equal(stableBookKey('Example',['A','B']),stableBookKey('Example',['B','A'])));
