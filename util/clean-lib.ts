#!/usr/bin/env npx ts-node

// test/fixtures/export/two ISSN number are freezing browser #110 + Generating keys and export broken #111.json 

import AJV from 'ajv'
const ajv = new AJV
const validate = ajv.compile(require('../test/features/steps/bbtjsonschema.json'))
import * as jsonpatch from 'fast-json-patch'

import { normalize } from '../translators/lib/normalize'
import { stable_stringify as stringify } from '../content/stringify'
import * as fs from 'fs'
import { sync as glob } from 'glob'
import * as path from 'path'

import { defaults, names } from '../gen/preferences/meta'
const supported: string[] = names.filter(name => !['client', 'testing', 'platform', 'newTranslatorsAskRestart'].includes(name))

const argv = require("clp")()
if (argv.save && typeof argv.save !== 'boolean') {
  console.log('put --save at end of command line')
  process.exit(1)
}
if (argv.saveAll && typeof argv.saveAll !== 'boolean') {
  console.log('put --save-all at end of command line')
  process.exit(1)
}

const localeDateOrder = argv.localeDateOrder ? argv.localeDateOrder.split('=') : null

if (argv._.length === 0) {
  if (argv.save) {
    console.log('use --save-all for global replace')
    process.exit(1)
  }
  argv._ = glob('test/fixtures/*/*.json')
  argv.save = argv['save-all']
}
argv._.sort()
console.log(`## inspecting ${argv._.length} files`)

const extensions = [
  '.schomd.json',
  '.csl.json',
  '.json',
]
/*
function sortkey(item) {
  return [ item.dateModified || item.dateAdded, item.itemType, `${item.itemID}` ].join('\t')
}
*/

function stripCC(input) {
  var output = ''
  for (var i=0; i<input.length; i++) {
    if (input.charCodeAt(i) >= 32) output += input.charAt(i)
  }
  return output
}

function clean(item) {
  delete item.libraryID
  delete item.uri
  delete item.dateAdded
  delete item.dateModified
  delete item.relations
  delete item.select
  delete item.itemKey
  delete item.contentType
  delete item.linkMode
  delete item.filename
  delete item.localPath
}

for (const lib of argv._) {
  const ext = extensions.find(ext => lib.endsWith(ext))

  if (ext === '.schomd.json' || ext === '.csl.json') continue

  const pre = JSON.parse(stripCC(fs.readFileSync(lib, 'utf-8')))
  const post = JSON.parse(JSON.stringify(pre))

  switch (ext) {
    case '.json':
      normalize(post, false)
      delete post.version

      if (localeDateOrder && post.config.localeDateOrder === localeDateOrder[0]) post.config.localeDateOrder = localeDateOrder[1]

      if (post.config?.options) {
        for (const [option, on] of Object.entries(post.config.options)) {
          if (option === 'Normalize' && on) delete post.config.options[option]
          if (option !== 'Normalize' && !on) delete post.config.options[option]
        }
      }

      if (post.config?.preferences) {
        for (const [pref, value] of Object.entries(post.config.preferences)) {
          if (!supported.includes(pref) || value === defaults[pref]) delete post.config.preferences[pref]
        }
      }

      // post.items.sort((a, b) => sortkey(a).localeCompare(sortkey(b)))
      for (const item of (post.items || [])) {
        clean(item)

        delete item.multi

        for (const creator of (item.creators || [])) {
          delete creator.multi
        }

        if (item.attachments) {
          item.attachments = item.attachments.filter(att => {
            if (att.path && !fs.existsSync(path.join(path.dirname(lib), att.path))) {
              return false
            }
            else {
              clean(att)
              return true
            }
          })
        }
      }
      break
    case '.csl.json':
      // post.sort((a, b) => stringify(a).localeCompare(stringify(b)))
      break
  }

  if (!validate(post)) {
    console.log(lib)
    console.log(validate.errors)
  }

  const diff = jsonpatch.compare(pre, post)
  if (diff.length > 0) {
    console.log(lib)
    if (argv.save) {
      console.log('  saving')
      fs.writeFileSync(lib, stringify(post, null, 2, true))
    } else {
      console.log(diff)
    }
  }
}
