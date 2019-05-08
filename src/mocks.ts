import { StandardDataSource, Interface, BaseClass, Manager } from 'pont-engine';
import { StandardDataType, Property } from 'pont-engine';
import * as http from 'http';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import * as ts from 'typescript';

const DEFAULT_ARR_LENGTH = 3;
const DEFAULT_STRING = '我是字串';

export function getArr(arrItem, arrLength = DEFAULT_ARR_LENGTH) {
  const arr = [];

  for (let index = 0; index < arrLength; index++) {
    arr.push(arrItem);
  }

  return arr;
}

class Mocks {
  constructor(private ds: StandardDataSource) {}

  get bases() {
    return this.ds.baseClasses;
  }

  getBaseClassDefaultValue(clazz: BaseClass, typeArgs: StandardDataType[]) {
    const defaultValue = {};
    const templateArgNames = (clazz.templateArgs || []).map(
      arg => arg.typeName
    );

    clazz.properties.forEach(prop => {
      let { name, dataType } = prop;
      const templateIndex = dataType.templateIndex;

      if (templateIndex !== -1) {
        dataType = typeArgs[templateIndex];
      }

      defaultValue[name] = this.getDefaultMocks(prop.dataType);
    });

    return defaultValue;
  }

  getDefaultMocks(response: StandardDataType) {
    const {
      typeName,
      isDefsType,
      initialValue,
      typeArgs,
      templateIndex
    } = response;

    if (isDefsType) {
      const defClass = this.bases.find(bs => bs.name === typeName);

      if (!defClass) {
        return {};
      }

      return this.getBaseClassDefaultValue(defClass, typeArgs);
    } else if (typeName === 'Array') {
      if (typeArgs.length) {
        const item = this.getDefaultMocks(typeArgs[0]);
        return getArr(item);
      }
      return [];
    } else if (typeName === 'string') {
      return DEFAULT_STRING;
    } else if (typeName === 'number') {
      return Math.random() * 100;
    } else if (typeName === 'boolean') {
      return true;
    } else {
      return null;
    }
  }

  getMocks() {
    const mods = {};
    this.ds.mods.forEach(mod => {
      const modMocks = {};
      mods[mod.name] = modMocks;

      mod.interfaces.forEach(inter => {
        const response = this.getDefaultMocks(inter.response);
        modMocks[inter.name] = response;
      });
    });

    return mods;
  }

  getMocksCode(wrapper) {
    const mocksData = this.getMocks();

    return `
      export default {
      ${Object.keys(mocksData)
        .map(modName => {
          return `${modName}: {
            ${Object.keys(mocksData[modName])
              .map(interName => {
                const interRes = mocksData[modName][interName];

                return `
                  ${interName}: ${wrapper(interRes)}
                `;
              })
              .join(',\n')}
          }`;
        })
        .join(',\n')}
      }
    `;
  }
}

export class MocksServer {
  constructor(private manager: Manager) {}

  static singleInstance = null as MocksServer;

  static getSingleInstance(manager?: Manager) {
    if (!MocksServer.singleInstance) {
      MocksServer.singleInstance = new MocksServer(manager);
      return MocksServer.singleInstance;
    }

    return MocksServer.singleInstance;
  }

  private async getMocksData() {
    const dsName = this.manager.currConfig.name || 'root';
    const mocksData = new Mocks(this.manager.currLocalDataSource).getMocks();

    return {
      [dsName]: mocksData
    };
  }

  async getCurrMocksData() {
    const rootPath = vscode.workspace.rootPath;
    const mockPath = path.join(rootPath, '.mocks.ts');
    const code = fs.readFileSync(mockPath, 'utf8');
    const tempPath = path.join(rootPath, '.temp.js');

    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    const jsResult = ts.transpileModule(code, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2015,
        module: ts.ModuleKind.CommonJS
      }
    }).outputText;
    fs.writeFileSync(tempPath, jsResult);
    const currMocksData = require(tempPath).mocksData;

    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }

    return currMocksData;
  }

  async checkMocksPath() {
    const rootPath = vscode.workspace.rootPath;
    const mockPath = path.join(rootPath, '.mocks.ts');
    const dsName = this.manager.currConfig.name || 'root';
    const mocksData = await this.getMocksData();

    if (!fs.existsSync(mockPath)) {
      await fs.writeFile(
        mockPath,
        'export const mocksData = ' + JSON.stringify(mocksData)
      );
    } else {
      const currMocksData = await this.getCurrMocksData();

      if (!currMocksData[dsName]) {
        currMocksData[dsName] = mocksData[dsName];
      }

      currMocksData[dsName] = Object.assign(
        {},
        mocksData[dsName],
        currMocksData[dsName]
      );

      this.manager.currLocalDataSource.mods.forEach(mod => {
        const modName = mod.name;

        currMocksData[dsName][modName] = Object.assign(
          {},
          mocksData[dsName][modName],
          currMocksData[dsName][modName]
        );
      });

      await fs.writeFile(
        mockPath,
        'export const mocksData = ' + JSON.stringify(currMocksData, null, 2)
      );
    }
  }

  createServer() {
    const rootPath = vscode.workspace.rootPath;
    const ds = this.manager.currLocalDataSource;
    const dsName = this.manager.currConfig.name || 'root';
    const wrapper = this.manager.currConfig.mocks.wrapper;
    const host = this.manager.currConfig.mocks.host;

    http
      .createServer(async (req, res) => {
        const mocksData = await this.getCurrMocksData();

        ds.mods.forEach(mod => {
          mod.interfaces.forEach(async inter => {
            const reg = new RegExp(
              inter.path
                .replace(/\//g, '\\/')
                .replace(/{.+?}/g, '[0-9a-zA-Z_-]+?')
            );

            if (
              req.url.match(reg) &&
              req.method.toUpperCase() === inter.method.toUpperCase()
            ) {
              const wrapperRes = wrapper.replace(
                /\{response\}/,
                JSON.stringify(
                  mocksData[dsName || 'root'][mod.name][inter.name]
                )
              );
              res.writeHead(200, {
                'Content-Type': 'text/json'
              });
              res.end(wrapperRes, 'utf-8');
            }
          });
        });
        res.writeHead(404);
        res.end();
      })
      .listen(host);
  }

  async run() {
    await this.checkMocksPath();
    await this.createServer();
  }
}

export default {
  a: 3
};
