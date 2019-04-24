import { StandardDataSource, Interface, BaseClass, Manager } from 'pont-engine';
import { StandardDataType, Property } from 'pont-engine';
import * as http from 'http';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';

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
      const item = this.getDefaultMocks(typeArgs[0]);
      return getArr(item);
    } else if (typeName === 'string') {
      return DEFAULT_STRING;
    } else if (typeName === 'number') {
      return Math.random() * 100;
    } else if (typeName === 'boolean') {
      return true;
    } else {
      return {};
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

  async checkMocksPath() {
    const rootPath = vscode.workspace.rootPath;
    const mockPath = path.join(rootPath, '.mocks.ts');
    const dsName = this.manager.currConfig.name || 'root';
    const mocksData = await this.getMocksData();

    if (!fs.existsSync(mockPath)) {
      await fs.writeFile(mockPath, JSON.stringify(mocksData));
    } else {
      const mocksDataStr = await fs.readFile(mockPath, 'utf-8');
      const currMocksData = JSON.parse(mocksDataStr);

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

      await fs.writeFile(mockPath, JSON.stringify(currMocksData));
    }
  }

  createServer() {
    const rootPath = vscode.workspace.rootPath;
    const mockPath = path.join(rootPath, '.mocks-json');
    const ds = this.manager.currLocalDataSource;
    const dsName = this.manager.currConfig.name || 'root';
    const wrapper = this.manager.currConfig.mocks.wrapper;
    const host = this.manager.currConfig.mocks.host;

    http
      .createServer((req, res) => {
        ds.mods.forEach(mod => {
          mod.interfaces.forEach(async inter => {
            const reg = new RegExp(
              inter.path
                .replace(/\//g, '\\/')
                .replace(/{.+?}/g, '[0-9a-zA-Z_-]+?')
            );
            const mocksDataStr = await fs.readFile(mockPath, 'utf-8');
            const mocksData = JSON.parse(mocksDataStr);

            const wrapperRes = wrapper.replace(
              /\{response\}/,
              JSON.stringify(mocksData[dsName][mod.name][inter.name])
            );

            if (req.url.match(reg)) {
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
