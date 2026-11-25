#!/usr/bin/env python3
"""Validate execution contracts using JSON Schema Draft 2020-12 (jsonschema).
Run: python3 scripts/qa/validateExecutionEvidence.py < openapi.json
"""
import copy
import json
import sys

from jsonschema import Draft202012Validator, FormatChecker

document = json.load(sys.stdin)
schemas = document["components"]["schemas"]
hash_value = "a" * 64
timestamp = "2026-09-18T01:02:00Z"
proof = dict(oldestLedger=1, latestLedger=100, latestLedgerClosedAt=timestamp, checkedAt=timestamp)
classic_proof = dict(proof, oldestLedgerClosedAt="2026-09-18T00:59:00Z", validAfter="2026-09-18T01:00:00Z", validUntil="2026-09-18T01:01:00Z")
classic_observation = dict(transactionHash=hash_value, ledger=42, submittedAt=timestamp, successful=True)
soroban_observation = dict(version=1, transactionHash=hash_value, ledger=42, authorizationPlanDigest=hash_value, authorizationPlanRevision=1, executionSource="G"+"A"*55, observedAt=timestamp, successful=True)
common = dict(version=1, transactionHash=hash_value, replayed=False)
cases = 0

def check(name, value, valid):
    global cases
    schema = dict(schemas[name], components=document["components"])
    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = list(validator.iter_errors(value))
    if bool(errors) == valid:
        raise AssertionError((name, valid, value, [error.message for error in errors]))
    cases += 1

for name, base, observation, absence in [
    ("ContractIntentExecutionReconcileResult", dict(common, operation="contract.intent.execution.reconcile"), soroban_observation, proof),
    ("ClassicExecutionReconcileResult", dict(common, operation="integration.request.execution.reconcile", requestId="CLASSICRESULT001", network="testnet"), classic_observation, classic_proof),
    ("ClassicExecutionEvidence", {}, classic_observation, classic_proof),
]:
    for outcome in ("unknown", "successful", "failed", "not_included"):
        expected = dict(base, outcome=outcome, observed=outcome in ("successful", "failed"))
        if outcome == "not_included":
            expected["nonInclusionProof"] = absence
        elif outcome in ("successful", "failed"):
            expected["observation"] = dict(observation, successful=outcome == "successful")
        check(name, expected, True)
        check(name, dict(expected, observed=not expected["observed"]), False)
        if outcome == "unknown":
            check(name, dict(expected, observation=observation), False)
            check(name, dict(expected, nonInclusionProof=absence), False)
        elif outcome == "not_included":
            incomplete = copy.deepcopy(expected)
            del incomplete["nonInclusionProof"]
            check(name, incomplete, False)
            check(name, dict(expected, nonInclusionProof={}), False)
            check(name, dict(expected, observation=observation), False)
        else:
            incomplete = copy.deepcopy(expected)
            del incomplete["observation"]
            check(name, incomplete, False)
            check(name, dict(expected, observation={}), False)
            check(name, dict(expected, observation=dict(observation, successful=outcome != "successful")), False)
            check(name, dict(expected, nonInclusionProof=absence), False)
        if outcome == "successful":
            incomplete = copy.deepcopy(expected)
            del incomplete["observation"]["ledger"]
            check(name, incomplete, False)

for field in ("transactionHash", "ledger", "submittedAt"):
    submission = {k:v for k,v in classic_observation.items() if k != "successful"}
    check("SigningRequestSubmission", submission, True)
    del submission[field]
    check("SigningRequestSubmission", submission, False)

# Compact projections are payment evidence too, not just a convenient state label.
for name, base in [
    ("AgentTask", dict(version=1, id="fixture", kind="classic_transaction", network="testnet", signatureRequired=False, nextActions=[])),
    ("AgentTask", dict(version=1, id="fixture", kind="soroban_contract", network="testnet", signatureRequired=False, nextActions=[])),
    ("IntegrationSorobanJob", dict(version=1, id="fixture", kind="soroban_contract", network="testnet", nextActions=[], actionCalls={}, reviewUrl="https://example.test/a")),
]:
    result = dict(transactionHash=hash_value, ledger=42, successful=True)
    completed = dict(base, state="completed", result=result)
    check(name, completed, True)
    check(name, dict(base, state="completed"), False)
    check(name, dict(completed, result=dict(result, successful=False)), False)
    check(name, dict(completed, result=dict(transactionHash=hash_value, successful=True)), False)
    check(name, dict(completed, state="failed"), False)
    check(name, dict(completed, unresolvedTransactionHashes=[hash_value]), False)
    if name == "AgentTask":
        check(name, dict(completed, signatureRequired=True), False)
        action = dict(code="reconcile_execution", operationId="contract.intent.execution.reconcile", requiredAccess="write", available=True)
        check(name, dict(completed, nextActions=[action]), False)
    else:
        check(name, dict(completed, nextActions=["refresh_execution"]), False)
        check(name, dict(completed, actionCalls={"refresh_execution": dict(operationId="integration.intent.execution.prepare", bodyDefaults=dict(action="refresh_execution"))}), False)

task = dict(version=1, id="fixture", kind="classic_transaction", network="testnet", signatureRequired=False, nextActions=[], state="execution_unknown", executionOutcome=dict(outcome="unknown", observed=False))
check("AgentTask", task, True)
check("AgentTask", dict(task, state="failed"), False)
check("AgentTask", dict(task, state="completed", result=dict(transactionHash=hash_value, ledger=42, successful=True)), False)
check("AgentTask", dict(task, result=dict(transactionHash=hash_value, ledger=42, successful=False)), False)
missing = dict(task)
del missing["executionOutcome"]
check("AgentTask", missing, False)
failed = dict(task, state="failed", executionOutcome=dict(outcome="failed", observed=True, observation=dict(classic_observation, successful=False)), result=dict(transactionHash=hash_value, ledger=42, successful=False))
check("AgentTask", failed, True)
del failed["result"]
check("AgentTask", failed, False)
absent = dict(task, state="expired", executionOutcome=dict(outcome="not_included", observed=False, nonInclusionProof=classic_proof))
check("AgentTask", absent, True)
check("AgentTask", dict(absent, state="failed"), False)
event = dict(version=1, eventId="evidence", type="execution_not_included", occurredAt=timestamp, authorizationPlanDigest=hash_value, authorizationPlanRevision=1, transactionHash=hash_value)
check("SorobanIntentEvidenceEvent", event, False)
check("SorobanIntentEvidenceEvent", dict(event, nonInclusionProof=proof), True)
check("SorobanIntentEvidenceEvent", dict(event, nonInclusionProof=proof, successful=True), False)
confirmed = dict(event, type="execution_confirmed", ledger=42, successful=True, observedAt=timestamp)
check("SorobanIntentEvidenceEvent", confirmed, True)
check("SorobanIntentEvidenceEvent", dict(confirmed, successful=False), False)
check("SorobanIntentEvidenceEvent", dict(event, type="execution_failed"), False)
replay = dict(common, operation="contract.intent.execution.reconcile", outcome="failed", observed=True, observation=dict(soroban_observation, successful=False), projectionNotRefreshed=True)
check("ContractIntentExecutionReconcileResult", replay, True)
check("ContractIntentExecutionReconcileResult", dict(replay, job=dict(version=1, id="fixture", kind="soroban_contract", network="testnet", state="failed", nextActions=[], actionCalls={}, reviewUrl="https://example.test/a")), False)
print(f"PASS {cases} JSON Schema positive/negative cases (including compact projections)")
