/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
    Uri,
    ExtensionContext, TextDocument, CodeLens, CancellationToken, CodeLensProvider
} from 'vscode';

import { DomainInfo, TypeObjects } from '../../../common/src/DomainInfo';
import { ProblemInfo } from '../../../common/src/ProblemInfo';

import * as path from 'path';
import { CodePddlWorkspace } from '../workspace/CodePddlWorkspace';
import { PddlTokenType } from '../../../common/src/PddlTokenizer';
import { nodeToRange } from '../utils';
import { DocumentInsetCodeLens, DocumentCodeLens } from './view';
import { ProblemView, ProblemRendererOptions, ProblemRenderer } from './ProblemView';
import { GraphViewData, NetworkEdge, NetworkNode } from './GraphViewData';
import { ProblemViewPanel } from './ProblemViewPanel';

const CONTENT = path.join('views', 'modelView');

const PDDL_PROBLEM_OBJECTS_PREVIEW_COMMAND = "pddl.problem.objects.preview";
const PDDL_PROBLEM_OBJECTS_INSET_COMMAND = "pddl.problem.objects.inset";

export class ProblemObjectsView extends ProblemView<ProblemObjectsRendererOptions, GraphViewData> implements CodeLensProvider {

    constructor(context: ExtensionContext, codePddlWorkspace: CodePddlWorkspace) {
        super(context, codePddlWorkspace, new ProblemObjectsRenderer(), {
            content: CONTENT,
            viewCommand: PDDL_PROBLEM_OBJECTS_PREVIEW_COMMAND,
            insetViewCommand: PDDL_PROBLEM_OBJECTS_INSET_COMMAND,
            insetHeight: 5,
            webviewType: 'problemObjectsPreview',
            webviewHtmlPath: 'graphView.html',
            webviewOptions: {
                enableFindWidget: true,
                // enableCommandUris: true,
                retainContextWhenHidden: true,
                enableScripts: true,
                localResourceRoots: [
                    Uri.file(context.extensionPath)
                ]
            }
        },
            {}
        );
    }

    async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
        if (token.isCancellationRequested) { return null; }
        let problem = await this.parseProblem(document);
        if (token.isCancellationRequested) { return null; }
        if (!problem) { return []; }

        let defineNode = problem.syntaxTree.getDefineNodeOrThrow();
        let objectsNode = defineNode.getFirstChild(PddlTokenType.OpenBracketOperator, /\s*:objects/i);
        if (objectsNode) {
            return [
                new DocumentCodeLens(document, nodeToRange(document, objectsNode))
            ];
        }
        else {
            return [];
        }
    }

    async resolveCodeLens(codeLens: CodeLens, token: CancellationToken): Promise<CodeLens> {
        if (!(codeLens instanceof DocumentCodeLens)) {
            return null;
        }
        if (token.isCancellationRequested) { return null; }
        let [domain] = await this.getProblemAndDomain(codeLens.getDocument());
        if (!domain) { return null; }
        if (token.isCancellationRequested) { return null; }

        if (codeLens instanceof DocumentInsetCodeLens) {
            codeLens.command = { command: PDDL_PROBLEM_OBJECTS_INSET_COMMAND, title: 'View inset', arguments: [codeLens.getDocument().uri, codeLens.getLine()] };
            return codeLens;
        }
        else {
            codeLens.command = { command: PDDL_PROBLEM_OBJECTS_PREVIEW_COMMAND, title: 'View', arguments: [codeLens.getDocument().uri] };
            return codeLens;
        }
    }

    protected createPreviewPanelTitle(uri: Uri) {
        return `:objects of '${path.basename(uri.fsPath)}'`;
    }

    protected async handleOnLoad(panel: ProblemViewPanel): Promise<boolean> {
        await panel.postMessage('setInverted', { value: true });
        return super.handleOnLoad(panel);
    }
}

class ProblemObjectsRenderer implements ProblemRenderer<ProblemObjectsRendererOptions, GraphViewData> {
    render(context: ExtensionContext, problem: ProblemInfo, domain: DomainInfo, options: ProblemObjectsRendererOptions): GraphViewData {
        let renderer = new ProblemObjectsRendererDelegate(context, domain, problem, options);

        return {
            nodes: renderer.getNodes(),
            relationships: renderer.getRelationships()
        };
    }
}

class ProblemObjectsRendererDelegate {

    private nodes: Map<string, number> = new Map();
    private relationships: NetworkEdge[] = [];
    private objectsAndConstantsPerType: TypeObjects[];
    private lastIndex: number;
    private typeNames = new Set<string>();

    constructor(_context: ExtensionContext, private domain: DomainInfo, private problem: ProblemInfo, _options: ProblemObjectsRendererOptions) {
        this.objectsAndConstantsPerType = TypeObjects.concatObjects(this.domain.getConstants(), this.problem.getObjectsPerType());

        domain.getTypesInclObject().forEach((t, index) => {
            this.nodes.set(t, index);
            this.typeNames.add(t);
        });
        domain.getTypeInheritance().getEdges().forEach(edge => this.addEdge(edge, 'extends'));

        this.lastIndex = domain.getTypesInclObject().length;
        domain.getTypes().forEach(t => this.addObjects(t));
    }

    private addObjects(typeName: string): void {
        let objectsOfType = this.objectsAndConstantsPerType.find(element => element.type === typeName);
        if (objectsOfType) {
            let objects = objectsOfType.getObjects();
            objects.forEach((objectName, index) => {
                this.nodes.set(objectName, index + this.lastIndex);
                this.addEdge([objectName, typeName], '');
            });

            this.lastIndex += objects.length;
        }
    }

    private addEdge(edge: [string, string], label: string): void {
        this.relationships.push(this.toEdge(edge, label));
    }

    getNodes(): NetworkNode[] {
        return [...this.nodes.entries()].map(entry => this.toNode(entry));
    }

    private toNode(entry: [string, number]): NetworkNode {
        let [entryLabel, entryId] = entry;
        let shape = this.typeNames.has(entryLabel) ? "ellipse" : "box";
        return { id: entryId, label: entryLabel, shape: shape };
    }

    private toEdge(edge: [string, string], label: string): NetworkEdge {
        let [from, to] = edge;
        return { from: this.nodes.get(from), to: this.nodes.get(to), label: label };
    }

    getRelationships(): NetworkEdge[] {
        return this.relationships;
    }
}

interface ProblemObjectsRendererOptions extends ProblemRendererOptions {
}
