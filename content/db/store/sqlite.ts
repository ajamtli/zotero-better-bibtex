/* eslint-disable @typescript-eslint/member-ordering */

Components.utils.import('resource://gre/modules/osfile.jsm')

import { log } from '../../logger'
import * as l10n from '../../l10n'

// Components.utils.import('resource://gre/modules/Sqlite.jsm')
// declare const Sqlite: any

export class SQLite {
  public mode = 'reference'

  private conn: any = {}

  public async close(name: string, callback: ((v: null) => void)): Promise<void> {
    try {
      if (!this.conn[name]) return callback(null)

      const conn = this.conn[name]
      this.conn[name] = false


      await this.closeDatabase(conn, name, 'DB.Store.close called')
      callback(null)
    }
    catch (err) {
      callback(err)
    }
  }

  private async closeDatabase(conn, name, _reason) {
    if (!conn) return

    if (conn.closed) {
      log.error('DB.Store.closeDatabase: not re-closing connection', name)
      return
    }

    try {
      await conn.closeDatabase(true)
    }
    catch (err) {
      log.error('DB.Store.closeDatabase FAILED', name, err)
    }
  }

  // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
  public async exportDatabase(name: string, dbref: any, callback: ((v: null) => void)): Promise<void> {
    try {
      const conn = this.conn[name]

      if (conn === false) {
        log.error('DB.Store.exportDatabaseSQLiteAsync: save of', name, 'attempted after close')
      }
      else if (!conn) {
        log.error('DB.Store.exportDatabaseSQLiteAsync: save of', name, 'to unopened database')
      }
      else {
        await conn.executeTransaction(async () => {
          const names = (await conn.queryAsync(`SELECT name FROM "${name}"`)).map((coll: { name: string }) => coll.name)

          const parts = []
          for (const coll of dbref.collections) {
            const collname = `${name}.${coll.name}`
            if (coll.dirty || !names.includes(collname)) {
              parts.push(conn.queryAsync(`REPLACE INTO "${name}" (name, data) VALUES (?, ?)`, [collname, JSON.stringify(coll)]))
            }
          }

          parts.push(conn.queryAsync(`REPLACE INTO "${name}" (name, data) VALUES (?, ?)`, [
            name,
            JSON.stringify({ ...dbref, ...{collections: dbref.collections.map(coll => `${name}.${coll.name}`)} }),
          ]))

          await Promise.all(parts)
        })
      }

      callback(null)
    }
    catch (err) {
      callback(err)
    }
  }

  public async loadDatabase(name: string, callback: ((v: null) => void)): Promise<void> {
    try {
      const conn = await this.openDatabaseSQLiteAsync(name)
      await conn.queryAsync(`CREATE TABLE IF NOT EXISTS "${name}" (name TEXT PRIMARY KEY NOT NULL, data TEXT NOT NULL)`)

      let db = null
      const collections: Record<string, any> = {}

      let failed = false

      let rows = 0
      for (const row of await conn.queryAsync(`SELECT name, data FROM "${name}" ORDER BY name ASC`)) {
        rows += 1
        try {
          if (row.name === name) {
            db = JSON.parse(row.data)
          }
          else {
            collections[row.name] = JSON.parse(row.data)

            collections[row.name].cloneObjects = true // https://github.com/techfort/LokiJS/issues/47#issuecomment-362425639
            collections[row.name].adaptiveBinaryIndices = false // https://github.com/techfort/LokiJS/issues/654
            collections[row.name].dirty = true
          }
        }
        catch (err) {
          log.error(`DB.Store.loadDatabaseSQLiteAsync: failed to load ${name}:`, row.name)
          failed = true
        }
      }

      if (db) {
        const missing = db.collections.filter(coll => !collections[coll])
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        db.collections = db.collections.map((coll: string) => collections[coll]).filter(coll => coll)
        if (missing.length) {
          log.error(`DB.Store.loadDatabaseSQLiteAsync: could not find ${name}.${missing.join('.')}`)
        }

      }
      else if (rows) {
        log.error('DB.Store.loadDatabaseSQLiteAsync: could not find metadata for', name, rows)
        failed = true

      }

      this.conn[name] = conn

      if (failed) {
        log.error('DB.Store.loadDatabaseSQLiteAsync failed, returning empty database')
        callback(null)
      }
      else {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        callback(db)
      }
    }
    catch (err) {
      callback(err)
    }
  }

  private async openDatabaseSQLiteAsync(name, fatal = false) {
    const path = OS.Path.join(Zotero.DataDirectory.dir, `${name}.sqlite`)

    const conn = new Zotero.DBConnection(name)
    try {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      if (await conn.integrityCheck()) return conn
      throw new Error(`DB.Store.openDatabaseSQLiteAsync(${JSON.stringify(name)}) failed: integrity check not OK`)

    }
    catch (err) {
      log.error('DB.Store.openDatabaseSQLiteAsync:', { name, fatal }, err)
      if (fatal) throw err

      // restore disabled until I Zotero supports after-open restore
      const ps = Services.prompt
      const index = ps.confirmEx(
        null, // parent
        l10n.localize('DB.corrupt'), // dialogTitle
        l10n.localize('DB.corrupt.explanation', { error: err.message }), // text
        // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
        ps.BUTTON_POS_0 * ps.BUTTON_TITLE_IS_STRING + ps.BUTTON_POS_0_DEFAULT // buttons
          + ps.BUTTON_POS_1 * ps.BUTTON_TITLE_IS_STRING
          + 0, // disabled: (fatal ? 0 : ps.BUTTON_POS_2 * ps.BUTTON_TITLE_IS_STRING),
        l10n.localize('DB.corrupt.quit'), // button 0
        l10n.localize('DB.corrupt.reset'), // button 1
        null, // disabled: (fatal ? null : l10n.localize('DB.corrupt.restore')), // button 2
        null, // check message
        {} // check state
      )

      await this.closeDatabase(conn, name, 'corrupted')

      switch (index) {
        case 0: // quit
          Zotero.Utilities.Internal.quit()
          break

        case 1: // reset
          if (await OS.File.exists(path)) await OS.File.move(path, `${path}.ignore.corrupt`)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return await this.openDatabaseSQLiteAsync(name, true)

        default: // restore
          if (await OS.File.exists(path)) await OS.File.move(path, `${path}.is.corrupt`)
          Zotero.Utilities.Internal.quit(true)
          break
      }
    }
  }
}
