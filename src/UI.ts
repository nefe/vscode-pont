import { Manager, Interface } from 'pont-engine';
import * as vscode from 'vscode';
import * as _ from 'lodash';
import * as path from 'path';
import { wait, showProgress } from './utils';
import * as events from 'events';
import { syncNpm } from './utils';
import { MocksServer } from './mocks';
import * as fs from 'fs-extra';
export class UI {
  private control: Control;

  /** 切换数据源 */
  originBar: vscode.StatusBarItem;
  /** 远程更新 */
  syncBar: vscode.StatusBarItem;
  allBar: vscode.StatusBarItem;
  modBar: vscode.StatusBarItem;
  boBar: vscode.StatusBarItem;
  /** 重新生成代码 */
  geBar: vscode.StatusBarItem;

  constructor(control: Control) {
    this.originBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left
    );
    this.originBar.command = control.commands.switchOrigin;

    this.syncBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left
    );
    this.allBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left
    );
    this.modBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left
    );
    this.boBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left
    );
    this.geBar = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left
    );

    this.syncBar.command = control.commands.syncRemote;
    this.allBar.command = control.commands.updateAll;
    this.modBar.command = control.commands.updateMod;
    this.boBar.command = control.commands.updateBo;
    this.geBar.command = control.commands.regenerate;

    this.control = control;
  }

  reRender() {
    if (this.control.isMultiple) {
      const currConfig = this.control.manager.currConfig;

      this.originBar.text = `origin(${currConfig.name})`;
      this.originBar.color = 'yellow';
      this.originBar.show();
    }

    this.syncBar.text = 'sync';
    this.syncBar.color = 'yellow';
    this.syncBar.tooltip = '远程数据源同步';
    this.syncBar.show();

    const diffs = this.control.manager.diffs;

    this.allBar.text = 'all';
    this.allBar.color =
      diffs.boDiffs.length || diffs.modDiffs.length ? 'yellow' : 'white';
    this.allBar.tooltip = '更新本地所有';
    this.allBar.show();

    this.modBar.text = `mod(${diffs.modDiffs.length})`;
    this.modBar.color = diffs.modDiffs.length ? 'yellow' : 'white';
    this.modBar.tooltip = '更新本地模块';
    this.modBar.show();

    this.boBar.text = `bo(${diffs.boDiffs.length})`;
    this.boBar.color = diffs.boDiffs.length ? 'yellow' : 'white';
    this.boBar.tooltip = '更新本地基类';
    this.boBar.show();

    this.geBar.text = 'generate';
    this.geBar.color = 'yellow';
    this.geBar.tooltip = '重新生成本地代码';
    this.geBar.show();
  }
}

export class Control {
  private static singleInstance: Control;

  public async initInstance() {
    if (!this.ui) {
      this.ui = new UI(this);
    }
    this.ui.reRender();

    return showProgress('ready', this.manager, async () => {
      try {
        await this.manager.ready();
      } catch (e) {
        vscode.window.showErrorMessage(e.toString());
      }
      this.manager.calDiffs();

      this.ui.reRender();
    });
  }

  public static getSingleInstance(manager: Manager) {
    if (!Control.singleInstance) {
      Control.singleInstance = new Control(manager);
    } else if (manager) {
      const instance = Control.singleInstance;
      instance.manager = manager;
    }

    return Control.singleInstance;
  }

  manager: Manager;
  ui: UI;
  commands = {
    switchOrigin: 'pont.switchOrigin',
    updateMod: 'pont.updateMod',
    updateBo: 'pont.updateBo',
    updateAll: 'pont.updateAll',
    syncRemote: 'pont.syncRemote',
    findInterface: 'pont.findInterface',
    regenerate: 'pont.regenerate'
  };
  dispose: Function;

  watchLocalFile() {
    const config = this.manager.currConfig;
    const lockWatcher = vscode.workspace.createFileSystemWatcher(
      path.join(config.outDir, 'api.lock'),
      true,
      false,
      true
    );
    let lockDispose = lockWatcher.onDidChange(async () => {
      if (this.manager.fileManager.created) {
        this.manager.fileManager.created = false;
        return;
      }
      await this.manager.readLocalDataSource();
      this.manager.calDiffs();
      this.ui.reRender();
    });

    this.dispose = () => {
      lockDispose.dispose();
    };
  }

  constructor(manager: Manager) {
    this.createCommands();

    this.manager = manager;

    this.watchLocalFile();
    this.createMenuCommand();
  }

  createMenuCommand() {
    vscode.commands.registerTextEditorCommand(
      'pont.jumpToMocks',
      (editor, edit) => {
        const mocksPath = path.join(
          vscode.workspace.rootPath,
          '.mocks/mocks.ts'
        );

        if (!fs.existsSync(mocksPath)) {
          vscode.window.showErrorMessage('mocks文件不存在！');
          return;
        }

        const pos = editor.selection.start;
        const codeAtLine = editor.document.getText().split('\n')[pos.line];

        if (!codeAtLine) {
          vscode.window.showErrorMessage('找不到接口');
          return;
        }

        const words = codeAtLine.split('.');

        if (words.length < 2) {
          vscode.window.showErrorMessage('找不到接口');
          return;
        }

        let wordIndex = 0;
        let chPos = 0;

        for (let index = 0; index < words.length; ++index) {
          const word = words[index];

          if (chPos + word.length > pos.character) {
            wordIndex = index;

            break;
          }

          chPos += word.length;
          // add . length
          chPos++;
        }

        if (wordIndex === 0) {
          return;
        }

        const wordsWithOrigin = [
          words[wordIndex - 2],
          words[wordIndex - 1],
          words[wordIndex]
        ];
        const justWords = [words[wordIndex - 1], words[wordIndex]];
        const matchedWords = [];
        let foundInterface = null as Interface;

        if (
          this.manager.allConfigs
            .map(config => config.name)
            .includes(wordsWithOrigin[0])
        ) {
          const dsName = wordsWithOrigin[0];
          const foundDs = this.manager.allLocalDataSources.find(
            ds => ds.name === dsName
          );

          if (foundDs) {
            const foundMod = foundDs.mods.find(
              mod => mod.name === wordsWithOrigin[1]
            );

            if (foundMod) {
              const foundInter = foundMod.interfaces.find(
                inter => inter.name === wordsWithOrigin[2]
              );

              if (foundInter) {
                matchedWords.push(dsName, foundMod.name, foundInter.name);
                foundInterface = foundInter;
              }
            }
          }
        }

        // 没有数据源名的情况
        if (!matchedWords.length) {
          const foundMod = this.manager.currLocalDataSource.mods.find(
            mod => mod.name === justWords[0]
          );

          if (foundMod) {
            const foundInter = foundMod.interfaces.find(
              inter => inter.name === justWords[1]
            );

            if (foundInter) {
              matchedWords.push(foundMod.name, foundInter.name);
              foundInterface = foundInter;
            }
          }
        }

        if (!matchedWords.length) {
          vscode.window.showErrorMessage('未找到该接口！');
          return;
        }

        vscode.workspace
          .openTextDocument(vscode.Uri.file(mocksPath))
          .then(doc => {
            const mocksCode = doc.getText();
            const codeIndex = mocksCode.indexOf(foundInterface.name + ':');

            if (codeIndex === -1) {
              vscode.window.showErrorMessage('Mocks文件不存在该接口！');
              return;
            }

            const lineNum = mocksCode.slice(0, codeIndex).split('\n').length;
            const lineIndex = mocksCode
              .split('\n')
              .slice(0, lineNum - 1)
              .join('\n').length;
            const ch = codeIndex - lineIndex + foundInterface.name.length;
            const pos = new vscode.Position(lineNum - 1, ch);

            vscode.window
              .showTextDocument(doc, {
                selection: new vscode.Selection(pos, pos)
              })
              .then(editor => {});
          });
      }
    );
  }

  get isMultiple() {
    return this.manager.allConfigs.length > 1;
  }

  createCommands() {
    _.forEach(this.commands, (value, key) => {
      vscode.commands.registerCommand(value, this[key].bind(this));
    });
  }

  findInterface(ignoreEdit = false) {
    const items = this.manager.currLocalDataSource.mods
      .map(mod => {
        return mod.interfaces.map(inter => {
          return {
            label: `[${inter.method}] ${inter.path}`,
            detail: `${mod.name}.${inter.name}`,
            description: `${inter.description}`
          } as vscode.QuickPickItem;
        });
      })
      .reduce((pre, next) => pre.concat(next), []);

    return vscode.window
      .showQuickPick(items, {
        matchOnDescription: true,
        matchOnDetail: true
      })
      .then(item => {
        if (!item) {
          return;
        }

        let code = `API.${item.detail}.`;

        if (this.manager.allLocalDataSources.length > 1) {
          code = `API.${this.manager.currLocalDataSource.name}.${item.detail}.`;
        }

        const editor = vscode.window.activeTextEditor;

        if (!ignoreEdit) {
          editor.edit(builder => {
            if (editor.selection.isEmpty) {
              const position = editor.selection.active;

              builder.insert(position, code);
            } else {
              builder.replace(editor.selection, code);
            }
          });
        }

        return code.split('.').filter(id => id);
      });
  }

  switchOrigin() {
    const origins = this.manager.allConfigs.map(conf => {
      return {
        label: conf.name,
        description: conf.originUrl
      } as vscode.QuickPickItem;
    });

    vscode.window.showQuickPick(origins).then(
      async item => {
        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: ''
          },
          async p => {
            this.manager.setReport(info => {
              p.report({ message: info });
            });
            try {
              await this.manager.selectDataSource(item.label);
              this.manager.calDiffs();
              this.ui.reRender();

              MocksServer.getSingleInstance(this.manager).checkMocksPath();
            } catch (e) {
              vscode.window.showErrorMessage(e.message);
            }
          }
        );
      },
      e => {
        vscode.window.showErrorMessage(e.message);
      }
    );
  }

  updateMod() {
    const modDiffs = this.manager.diffs.modDiffs;
    const items = modDiffs.map(item => {
      return {
        label: item.name,
        description: `${item.details[0]}等 ${item.details.length} 条更新`
      } as vscode.QuickPickItem;
    });

    vscode.window.showQuickPick(items).then(
      thenItems => {
        if (!thenItems) {
          return;
        }

        const modName = thenItems.label;

        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'updateMod'
          },
          p => {
            return new Promise(async (resolve, reject) => {
              try {
                p.report({ message: '开始更新...' });

                this.manager.makeSameMod(modName);
                await this.manager.lock();

                this.manager.calDiffs();
                this.ui.reRender();

                p.report({ message: '更新成功！' });
                vscode.window.showInformationMessage(modName + '更新成功!');
                resolve();
              } catch (e) {
                reject(e);
              }
            });
          }
        );
      },
      e => {}
    );
  }

  updateBo() {
    const boDiffs = this.manager.diffs.boDiffs;

    const items = boDiffs.map(item => {
      return {
        label: item.name,
        description: item.details.join(', ')
      } as vscode.QuickPickItem;
    });

    vscode.window.showQuickPick(items).then(
      item => {
        if (!item) {
          return;
        }

        let boName = item.label;

        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'updateBo'
          },
          p => {
            return new Promise(async (resolve, reject) => {
              try {
                p.report({ message: '开始更新...' });

                this.manager.makeSameBase(boName);
                await this.manager.lock();

                this.manager.calDiffs();
                this.ui.reRender();

                p.report({ message: '更新成功！' });
                vscode.window.showInformationMessage(boName + '更新成功!');
                resolve();
              } catch (e) {
                reject(e);
              }
            });
          }
        );
      },
      e => {}
    );
  }

  updateAll() {
    vscode.window.showInformationMessage('确定全量更新吗？', '确定').then(
      text => {
        if (!text) {
          return;
        }

        vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'updateAll'
          },
          p => {
            return new Promise(async (resolve, reject) => {
              try {
                p.report({ message: '开始更新...' });

                this.manager.makeAllSame();

                await this.manager.lock();

                this.manager.calDiffs();
                this.ui.reRender();

                p.report({ message: '更新成功！' });
                vscode.window.showInformationMessage('更新成功!');

                resolve();
              } catch (e) {
                reject(e);
              }
            });
          }
        );
      },
      e => {}
    );
  }

  syncRemote() {
    showProgress('syncRemote', this.manager, async report => {
      report('远程更新中...');

      try {
        await this.manager.readRemoteDataSource();

        report('同步成功！');
        report('差异比对中...');
        this.manager.calDiffs();

        report('同步完成！');
        this.ui.reRender();
      } catch (e) {
        vscode.window.showErrorMessage(e.message);
      }
    });
  }

  async regenerate() {
    const e = new events.EventEmitter();

    showProgress('生成代码', this.manager, async report => {
      report('代码生成中...');
      await wait(100);

      await this.manager.regenerateFiles();

      report('代码生成成功！');
      vscode.window.showInformationMessage('文件生成成功！');
    });
  }

  async syncNpm() {
    await syncNpm();
  }
}
