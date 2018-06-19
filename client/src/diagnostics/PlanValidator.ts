/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
    window, commands, OutputChannel, ExtensionContext, TextDocument, Diagnostic, Uri, Range, DiagnosticSeverity
} from 'vscode';

import * as process from 'child_process';

import { PddlWorkspace } from '../../../common/src/workspace-model';
import { ProblemInfo, FileInfo, PlanInfo, PddlLanguage } from '../../../common/src/parser';
import { PddlConfiguration, CONF_PDDL, VALIDATION_PATH } from '../configuration';
import { Util } from '../../../common/src/util';
import { dirname } from 'path';
import { PlanStep } from '../../../common/src/PlanStep';

export const PDDL_PLAN_VALIDATE = 'pddl.plan.validate';

/**
 * Delegate for handling requests to run the planner and visualize the plans.
 */
export class PlanValidator {

    constructor(private output: OutputChannel, public pddlWorkspace: PddlWorkspace, public plannerConfiguration: PddlConfiguration, context: ExtensionContext) {

        context.subscriptions.push(commands.registerCommand(PDDL_PLAN_VALIDATE,
            async () => {
                if (window.activeTextEditor && window.activeTextEditor.document.languageId == "plan") {
                    if (!this.testConfiguration()) return;
                    try {
                        let outcome = await this.validateTextDocument(window.activeTextEditor.document);
                        if (outcome.getError()) {
                            window.showErrorMessage(outcome.getError());
                        }
                    } catch (ex) {
                        window.showErrorMessage("Plan validation failed: " + ex);
                        return;
                    }
                } else {
                    window.showErrorMessage("There is no plan file open.");
                    return;
                }
            }));
    }

    testConfiguration(): boolean {
        let validatePath = this.plannerConfiguration.getValidatorPath();
        if (validatePath.length == 0) {
            window.showErrorMessage(`Set the 'validate' executable path to the '${CONF_PDDL}.${VALIDATION_PATH}' setting.`);
            return false;
        }
        else {
            return true;
        }

        // if (this.validatorPath == null || this.validatorPath == "") {
        // suggest the user to update the settings
        // var showNever = true;
        // this.pddlConfiguration.suggestValidatorConfiguration(showNever);
        // return;
        // }
    }

    async validateTextDocument(planDocument: TextDocument): Promise<PlanValidationOutcome> {

        let planFileInfo = <PlanInfo>this.pddlWorkspace.upsertAndParseFile(planDocument.uri.toString(), PddlLanguage.PLAN, planDocument.version, planDocument.getText());

        if (!planFileInfo) return PlanValidationOutcome.failed(null, new Error("Cannot open or parse plan file."));

        return this.validatePlanAndReportDiagnostics(planFileInfo, true, _ => { }, _ => { });
    }

    async validatePlanAndReportDiagnostics(planInfo: PlanInfo, showOutput: boolean, onSuccess: (diagnostics: Map<string, Diagnostic[]>) => void, onError: (error: string) => void): Promise<PlanValidationOutcome> {
        let epsilon = this.plannerConfiguration.getEpsilonTimeStep();
        let validatePath = this.plannerConfiguration.getValidatorPath();

        let problemFileInfo: ProblemInfo;

        let folder = this.pddlWorkspace.getFolderOf(planInfo);
        folder.files.forEach((value: FileInfo) => {
            if (value instanceof ProblemInfo) {
                let problemInfo = <ProblemInfo>value;
                if (problemInfo.name.toLowerCase() == planInfo.problemName.toLowerCase()) {
                    problemFileInfo = value;
                }
            }
        });

        if (!problemFileInfo) {
            let outcome = PlanValidationOutcome.failed(planInfo, new Error(`No problem file with name '(problem ${planInfo.problemName}') and located in the same folder as the plan is not open in the editor.`));
            onSuccess(outcome.getDiagnostics());
            return outcome;
        }

        let domainFileInfo = this.pddlWorkspace.getDomainFileFor(problemFileInfo);

        if (!domainFileInfo) {
            let outcome = PlanValidationOutcome.failed(planInfo, new Error(`No domain file corresponding to problem '${problemFileInfo.name}' and located in the same folder is open in the editor.`));
            onSuccess(outcome.getDiagnostics());
            return outcome;
        }

        // copy editor content to temp files to avoid using out-of-date content on disk
        let domainFile = Util.toPddlFile('domain', domainFileInfo.text);
        let problemFile = Util.toPddlFile('problem', problemFileInfo.text);
        let planFile = Util.toPddlFile('plan', planInfo.text);

        let args = ['-t', epsilon.toString(), '-v', domainFile, problemFile, planFile];
        let child = process.spawnSync(validatePath, args, { cwd: dirname(Uri.parse(planInfo.fileUri).fsPath) });

        if (showOutput) this.output.appendLine(validatePath + ' ' + args.join(' '));

        let output = child.stdout.toString();

        if (showOutput) this.output.appendLine(output);

        if (showOutput && child.stderr) {
            this.output.append('Error:');
            this.output.appendLine(child.stderr.toString());
        }

        let outcome = this.analyzeOutput(planInfo, child.error, output);

        if (child.error) {
            if (showOutput) this.output.appendLine(`Error: name=${child.error.name}, message=${child.error.message}`);
            onError(child.error.name);
        }
        else {
            onSuccess(outcome.getDiagnostics());
        }

        if (showOutput) {
            this.output.appendLine(`Exit code: ${child.status}`);
            this.output.show();
        }

        return outcome;
    }

    analyzeOutput(planInfo: PlanInfo, error: Error, output: string): PlanValidationOutcome {
        if (error) {
            return PlanValidationOutcome.failed(planInfo, error);
        }

        if (output.match("Plan failed to execute") || output.match("Goal not satisfied")) {
            let failurePattern = /Checking next happening \(time (\d+.\d+)\)/g;
            var result: RegExpExecArray;
            var timeStamp = -1;
            while ((result = failurePattern.exec(output)) !== null) {
                timeStamp = parseFloat(result[1]);
            }

            let match = output.match(/Plan Repair Advice:([\s\S]+)Failed plans:/);
            if (match) {
                return PlanValidationOutcome.failedAtTime(planInfo, timeStamp, match[1].trim().split('\n'));
            } else {
                return PlanValidationOutcome.failedAtTime(planInfo, timeStamp, ["Unidentified error. Run the 'PDDL: Validate plan' command for more info."]);
            }
        }

        if (output.match("Bad plan description!")) {
            return PlanValidationOutcome.invalidPlanDescription(planInfo);
        } else if (output.match("Plan valid")) {
            return PlanValidationOutcome.valid(planInfo);
        }

        return PlanValidationOutcome.unknown(planInfo);
    }
}

class PlanValidationOutcome {
    constructor(public planInfo: PlanInfo, private diagnostics: Diagnostic[], public error: string = null) {

    }

    getError(): string {
        return this.error;
    }

    getDiagnostics(): Map<string, Diagnostic[]> {
        let diagnostics = new Map<string, Diagnostic[]>();
        diagnostics.set(this.planInfo.fileUri, this.diagnostics);
        return diagnostics;
    }

    static goalNotAttained(planInfo: PlanInfo): PlanValidationOutcome {
        let errorLine = planInfo.getSteps().length > 0 ? planInfo.getSteps().slice(-1).pop().lineIndex + 1 : 0;
        let error = "Plan does not reach the goal.";
        let diagnostics = [createDiagnostic(errorLine, error, DiagnosticSeverity.Warning)];
        return new PlanValidationOutcome(planInfo, diagnostics, error);
    }

    /**
     * Creates validation outcomes for invalid plan i.e. plans that do not parse or do not correspond to the domain/problem file.
     */
    static invalidPlanDescription(planInfo: PlanInfo): PlanValidationOutcome {
        let error = "Invalid plan description.";
        let diagnostics = [createDiagnostic(0, error, DiagnosticSeverity.Error)];
        return new PlanValidationOutcome(planInfo, diagnostics, error);
    }

    /**
     * Creates validation outcomes for valid plan, which does not reach the goal.
     */
    static valid(planInfo: PlanInfo): PlanValidationOutcome {
        return new PlanValidationOutcome(planInfo, [], undefined);
    }

    static failed(planInfo: PlanInfo, error: Error): PlanValidationOutcome {
        let message = "Validate tool failed. " + error.message;
        let diagnostics = [createDiagnostic(0, message, DiagnosticSeverity.Error)];
        return new PlanValidationOutcome(planInfo, diagnostics, message);
    }

    static failedAtTime(planInfo: PlanInfo, timeStamp: number, repairHints: string[]): PlanValidationOutcome {
        let errorLine = 0;
        let stepAtTimeStamp =
            planInfo.getSteps().find(step => PlanStep.equalsWithin(step.getStartTime(), timeStamp, 1e-4));
        if (stepAtTimeStamp) errorLine = stepAtTimeStamp.lineIndex;

        let diagnostics = repairHints.map(hint => new Diagnostic(createRangeFromLine(errorLine), hint, DiagnosticSeverity.Warning));
        return new PlanValidationOutcome(planInfo, diagnostics);
    }

    static unknown(planInfo: PlanInfo): PlanValidationOutcome {
        let diagnostics = [new Diagnostic(createRangeFromLine(0), "Unknown error. Run the 'PDDL: Validate plan' command for more information.", DiagnosticSeverity.Warning)];
        return new PlanValidationOutcome(planInfo, diagnostics, "Unknown error.");
    }
}

function createRangeFromLine(errorLine: number): Range {
    return new Range(errorLine, 0, errorLine, 100);
}

function createDiagnostic(errorLine: number, error: string, severity: DiagnosticSeverity): Diagnostic {
    return new Diagnostic(createRangeFromLine(errorLine), error, severity);
}