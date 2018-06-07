/* --------------------------------------------------------------------------------------------
 * Copyright (c) Jan Dolejsi. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
    Diagnostic, DiagnosticSeverity, DiagnosticCollection, Uri, window, Disposable, workspace
} from 'vscode';

import { Authentication } from '../../../common/src/Authentication';
import { PddlWorkspace } from '../../../common/src/workspace-model';
import { DomainInfo, ProblemInfo, FileInfo, FileStatus, Parser, PlanInfo } from '../../../common/src/parser';

import { Validator } from './validator';
import { ValidatorService } from './ValidatorService';
import { ValidatorExecutable } from './ValidatorExecutable';
import { PDDLParserSettings } from '../../../common/src/Settings';
import { PddlConfiguration, PDDL_PARSER, VALIDATION_PATH, PDDL_PLAN } from '../configuration';
import { PlanValidator } from './PlanValidator';

export class Diagnostics extends Disposable {

    pddlWorkspace: PddlWorkspace;
    pddlConfiguration: PddlConfiguration;
    timeout: NodeJS.Timer;
    validator: Validator;
    diagnosticCollection: DiagnosticCollection;
    pddlParserSettings: PDDLParserSettings;

    private defaultTimerDelayInSeconds = 3;

    constructor(pddlWorkspace: PddlWorkspace, diagnosticCollection: DiagnosticCollection, configuration: PddlConfiguration, private planValidator: PlanValidator) {
        super(() => this.pddlWorkspace.removeAllListeners()); //todo: this is probably too harsh
        this.diagnosticCollection = diagnosticCollection;
        this.pddlWorkspace = pddlWorkspace;
        this.pddlConfiguration = configuration;
        this.pddlParserSettings = configuration.getParserSettings();

        this.pddlWorkspace.on(PddlWorkspace.UPDATED, _ => this.scheduleValidation());
        this.pddlWorkspace.on(PddlWorkspace.REMOVING, (doc: FileInfo) => this.clearDiagnostics(doc.fileUri));

        workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration(PDDL_PARSER)
                || e.affectsConfiguration(PDDL_PLAN + '.' + VALIDATION_PATH)) {
                this.handleConfigurationChange();
            }
        });
    }

    scheduleValidation(): void {
        this.cancelScheduledValidation()
        let timerDelayInSeconds = this.pddlParserSettings.delayInSecondsBeforeParsing || this.defaultTimerDelayInSeconds;
        this.timeout = setTimeout(() => { this.validateAllDirty(); }, timerDelayInSeconds * 1000);
    }

    cancelScheduledValidation(): void {
        if (this.timeout) clearTimeout(this.timeout);
    }

    validateAllDirty(): void {
        // find all dirty unknown files
        let dirtyUnknowns = this.pddlWorkspace.getAllFilesIf(fileInfo => fileInfo.isUnknownPddl() && fileInfo.getStatus() == FileStatus.Parsed);

        // validate unknown files (those where the header does not parse)
        dirtyUnknowns.forEach(file => this.validateUnknownFile(file));

        // find all dirty domains
        let dirtyDomains = this.pddlWorkspace.getAllFilesIf(fileInfo => fileInfo.isDomain() && fileInfo.getStatus() == FileStatus.Parsed);

        if (dirtyDomains.length > 0) {
            let firstDirtyDomain = <DomainInfo>dirtyDomains[0];
            // if there was more than one domain schedule further validation
            let scheduleFurtherValidation = dirtyDomains.length > 1;

            this.validatePddlDocument(firstDirtyDomain, scheduleFurtherValidation);
            return;
        }

        // find all dirty problems
        let dirtyProblems = this.pddlWorkspace.getAllFilesIf(fileInfo => fileInfo.isProblem() && fileInfo.getStatus() == FileStatus.Parsed);

        if (dirtyProblems.length > 0) {
            let firstDirtyProblem = <ProblemInfo>dirtyProblems[0];

            // if there was more than one domain schedule further validation
            let scheduleFurtherValidation = dirtyProblems.length > 1;

            this.validatePddlDocument(firstDirtyProblem, scheduleFurtherValidation);
        }

        // find all dirty plans
        let dirtyPlans = this.pddlWorkspace.getAllFilesIf(fileInfo => fileInfo.isPlan() && fileInfo.getStatus() == FileStatus.Parsed);

        if (dirtyPlans.length > 0) {
            let firstDirtyPlan = <PlanInfo>dirtyPlans[0];

            // if there was more than one domain schedule further validation
            let scheduleFurtherValidation = dirtyPlans.length > 1;

            this.validatePlan(firstDirtyPlan, scheduleFurtherValidation);
        }
    }

    handleConfigurationChange(): void {
        this.pddlParserSettings = this.pddlConfiguration.getParserSettings();
        this.revalidateAll();
    }

    revalidateAll(): void {
        // mark all files as dirty
        this.pddlWorkspace.folders.forEach(folder => {
            folder.files
                .forEach(f => {
                    if (f.getStatus() != FileStatus.Dirty) f.setStatus(FileStatus.Parsed)
                }
                );
        });
        // revalidate all files
        this.cancelScheduledValidation(); // ... and validate immediately
        this.validateAllDirty();
    }

    validatePddlDocumentByUri(fileUri: string, scheduleFurtherValidation: boolean): void {
        let fileInfo = this.pddlWorkspace.getFileInfo(fileUri);
        this.validatePddlDocument(fileInfo, scheduleFurtherValidation);
    }

    validatePlan(planInfo: PlanInfo, scheduleFurtherValidation: boolean): void {
        if (planInfo == null) return;
        
        if (!this.planValidator.testConfiguration()) return;

        // mark the file as under validation
        planInfo.setStatus(FileStatus.Validating);

        console.log(`Validating ${planInfo.name} plan.`);

        this.planValidator.validatePlanAndReportDiagnostics(planInfo, false, (diagnostics) => {
            // Send the computed diagnostics to VSCode.
            this.sendDiagnostics(diagnostics);
            if (scheduleFurtherValidation) this.scheduleValidation();
        }, (err) => {
            window.showErrorMessage(err);
            console.warn(err);
            // var showNever = false;
            // this.pddlConfiguration.suggestNewValidatorConfiguration(showNever);
        });
    }

    validatePddlDocument(fileInfo: FileInfo, scheduleFurtherValidation: boolean): void {

        if (fileInfo == null) {
            console.log('File not found in the workspace.');
        }

        if (fileInfo.isDomain()) {
            let domainInfo = <DomainInfo>fileInfo;

            let problemFiles = this.pddlWorkspace.getProblemFiles(domainInfo);

            this.validateDomainAndProblems(domainInfo, problemFiles, scheduleFurtherValidation);
        }
        else if (fileInfo.isProblem()) {
            let problemInfo = <ProblemInfo>fileInfo;

            let domainFile = this.getDomainFileFor(problemInfo);

            if (domainFile != null) {
                this.validateDomainAndProblems(domainFile, [problemInfo], scheduleFurtherValidation);
            }
        }
        else {
            // this should not happen ?!
        }
    }

    validateDomainAndProblems(domainInfo: DomainInfo, problemFiles: ProblemInfo[], scheduleFurtherValidation: boolean): void {

        if (this.pddlParserSettings.executableOrService == null || this.pddlParserSettings.executableOrService == "") {
            // suggest the user to update the settings
            var showNever = true;
            this.pddlConfiguration.suggestNewParserConfiguration(showNever);
            return;
        }

        // mark the files that they are under validation
        domainInfo.setStatus(FileStatus.Validating);
        problemFiles.forEach(p => p.setStatus(FileStatus.Validating));

        // this.connection.console.log(`Validating ${domainInfo.name} and ${problemFiles.length} problem files.`)

        let validator = this.createValidator();
        if (!validator) return;

        validator.validate(domainInfo, problemFiles, (diagnostics) => {
            // Send the computed diagnostics to VSCode.
            this.sendDiagnostics(diagnostics);
            if (scheduleFurtherValidation) this.scheduleValidation();
        }, (err) => {
            window.showErrorMessage(err);
            console.warn(err);
            var showNever = false;
            this.pddlConfiguration.suggestNewParserConfiguration(showNever);
        });
    }

    createValidator(): Validator {
        if (!this.validator || this.validator.path != this.pddlParserSettings.executableOrService
            || (this.validator instanceof ValidatorExecutable) && (
                this.validator.syntax != this.pddlParserSettings.executableOptions ||
                this.validator.customPattern != this.pddlParserSettings.problemPattern
            )) {
            if (this.pddlParserSettings.executableOrService.match(/^http[s]?:/i)) {
                // is a service
                let authentication = new Authentication(
                    this.pddlParserSettings.serviceAuthenticationUrl,
                    this.pddlParserSettings.serviceAuthenticationRequestEncoded,
                    this.pddlParserSettings.serviceAuthenticationClientId,
                    this.pddlParserSettings.serviceAuthenticationCallbackPort,
                    this.pddlParserSettings.serviceAuthenticationTimeoutInMs,
                    this.pddlParserSettings.serviceAuthenticationTokensvcUrl,
                    this.pddlParserSettings.serviceAuthenticationTokensvcApiKey,
                    this.pddlParserSettings.serviceAuthenticationTokensvcAccessPath,
                    this.pddlParserSettings.serviceAuthenticationTokensvcValidatePath,
                    this.pddlParserSettings.serviceAuthenticationTokensvcCodePath,
                    this.pddlParserSettings.serviceAuthenticationTokensvcRefreshPath,
                    this.pddlParserSettings.serviceAuthenticationTokensvcSvctkPath,
                    this.pddlParserSettings.serviceAuthenticationRefreshToken,
                    this.pddlParserSettings.serviceAuthenticationAccessToken,
                    this.pddlParserSettings.serviceAuthenticationSToken);
                return this.validator = new ValidatorService(this.pddlParserSettings.executableOrService, this.pddlParserSettings.serviceAuthenticationEnabled, authentication);
            }
            else {
                return this.validator = new ValidatorExecutable(this.pddlParserSettings.executableOrService, this.pddlParserSettings.executableOptions, this.pddlParserSettings.problemPattern);
            }
        }
        else {
            return this.validator;
        }
    }

    sendDiagnostics(diagnostics: Map<string, Diagnostic[]>): void {
        diagnostics.forEach((diagnostics, fileUri) => this.diagnosticCollection.set(Uri.parse(fileUri), diagnostics));
    }

    getDomainFileFor(problemFile: ProblemInfo): DomainInfo {
        let folder = this.pddlWorkspace.folders.get(PddlWorkspace.getFolderUri(problemFile.fileUri));

        // find domain files in the same folder that match the problem's domain name
        let domainFiles = folder.getDomainFilesFor(problemFile);

        if (domainFiles.length > 1) {
            let message = `There are multiple candidate domains with name ${problemFile.domainName}: ` + domainFiles.map(d => PddlWorkspace.getFileName(d.fileUri)).join(', ');

            this.sendDiagnosticInfo(problemFile.fileUri, message);
            problemFile.setStatus(FileStatus.Validated);
            return null;
        }
        else if (domainFiles.length == 0) {
            // this.workspace.folders.forEach()

            let message = `There are no domains open in the same folder with name (domain '${problemFile.domainName}') open in the editor.`;

            this.sendDiagnosticInfo(problemFile.fileUri, message);
            problemFile.setStatus(FileStatus.Validated);
            return null;
        }
        else {
            return domainFiles[0];
        }

    }

    sendDiagnosticInfo(fileUri: string, message: string) {
        this.sendDiagnostic(fileUri, message, DiagnosticSeverity.Information);
    }

    sendDiagnostic(fileUri: string, message: string, severity: DiagnosticSeverity) {
        let diagnostics: Diagnostic[] = [new Diagnostic(Validator.createRange(0, 0), message, severity)];
        this.diagnosticCollection.set(Uri.parse(fileUri), diagnostics);
    }

    clearDiagnostics(fileUri: string): void {
        this.diagnosticCollection.delete(Uri.parse(fileUri));
    }

    validateUnknownFile(fileInfo: FileInfo): void {
        fileInfo.setStatus(FileStatus.Validating);

        if (fileInfo.text.length > 0) {
            let firstLine = Parser.stripComments(fileInfo.text).replace(/^\s+/g, '').split('\n')[0];

            this.sendDiagnostic(fileInfo.fileUri, `Cannot recognize whether this is a domain or problem: ${firstLine}`, DiagnosticSeverity.Error);
        }
        else {
            this.clearDiagnostics(fileInfo.fileUri);
        }

        fileInfo.setStatus(FileStatus.Validated);
    }
}