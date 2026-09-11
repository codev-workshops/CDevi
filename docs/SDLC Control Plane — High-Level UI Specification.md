# SDLC Control Plane
## High-Level UI Specification

**Version:** 0.1  
**Status:** Draft  
**Purpose:** High-level product/UI specification  
**Foundation:** OpenHands Agent Runtime + SDLC Control Plane

---

# 1. Product Overview

The **SDLC Control Plane** is an enterprise web application for orchestrating autonomous software engineering workflows across the complete Software Development Lifecycle.

It provides a single interface to:

- Manage software projects and repositories
- Monitor autonomous agents
- Track requirements and implementation
- Review AI-generated plans and designs
- Monitor code generation and testing
- Review pull requests and AI findings
- Approve or reject autonomous actions
- Monitor deployments
- Investigate production incidents
- Inspect agent activity and decisions
- Configure SDLC policies and automation

The UI should present the system as an **engineering control center**, rather than as a conventional AI chat application.

---

# 2. Design Principles

## 2.1 Human-in-the-loop by default

The system should clearly distinguish between:

- AI decisions
- AI recommendations
- Autonomous actions
- Human approvals
- Policy-controlled actions

Users should always understand:

> **What the agent is doing, why it is doing it, and what will happen next.**

---

## 2.2 Workflow-first

The primary UI abstraction should be the **SDLC Workflow**, not the AI agent.

Example:

```text
Requirement
    ↓
Analysis
    ↓
Architecture
    ↓
Design
    ↓
Implementation
    ↓
Testing
    ↓
Review
    ↓
PR
    ↓
Deployment
    ↓
Validation
```

Agents execute individual stages of the workflow.

---

## 2.3 Evidence over explanation

Every important AI decision should have supporting evidence.

Example:

```text
Recommendation:
Refactor PaymentService before implementing PAY-1234

Reason:
PaymentService is shared by 7 modules.

Evidence:
• 7 callers
• 3 APIs
• 12 related tests
• 2 open Jira issues
• Last modified 4 months ago
```

---

## 2.4 Progressive disclosure

The dashboard should remain simple.

Users should be able to drill down:

```text
Dashboard
   ↓
Project
   ↓
Workflow
   ↓
Stage
   ↓
Agent Run
   ↓
Decision
   ↓
Evidence / Logs / Artifacts
```

---

# 3. Global Application Layout

```text
┌─────────────────────────────────────────────────────────────────┐
│ Logo │ Project ▾ │ Search │ Notifications │ Approvals │ User ▾ │
├──────────────┬──────────────────────────────────────────────────┤
│              │                                                  │
│ Dashboard    │                                                  │
│ Projects     │                  MAIN CONTENT                    │
│ Workflows    │                                                  │
│ Requirements │                                                  │
│ Agents       │                                                  │
│ Reviews      │                                                  │
│ Testing      │                                                  │
│ Deployments  │                                                  │
│ Incidents    │                                                  │
│ Knowledge    │                                                  │
│              │                                                  │
│ ───────────  │                                                  │
│ Administration│                                                 │
│ Settings     │                                                  │
│              │                                                  │
└──────────────┴──────────────────────────────────────────────────┘
```

---

# 4. Primary Navigation

The left navigation should contain:

```text
Dashboard

Projects
  ├── Projects
  ├── Repositories
  └── Environments

SDLC
  ├── Workflows
  ├── Requirements
  ├── Architecture
  ├── Design
  ├── Implementation
  └── Testing

Engineering
  ├── Pull Requests
  ├── Reviews
  ├── Deployments
  └── Incidents

Agents
  ├── Agent Runs
  ├── Agent Fleet
  ├── Skills
  └── Models

Knowledge
  ├── Code Intelligence
  ├── Architecture
  ├── Documentation
  └── Decisions

Administration
  ├── Integrations
  ├── Policies
  ├── Permissions
  ├── Environments
  └── Audit Log
```

---

# 5. Global Header

The header should provide:

### Project Selector

```text
Project: Payments Platform ▾
```

### Global Search

Search across:

- Jira issues
- Requirements
- Repositories
- PRs
- Agents
- Workflows
- Architecture
- Documentation
- Incidents

Example:

```text
⌕ Search engineering knowledge...
```

### Notifications

Examples:

```text
3 workflow failures
2 approval requests
1 production incident
5 review findings
```

### Approval Queue

Prominent action:

```text
⚠ 4 Approvals
```

---

# 6. Executive / Engineering Dashboard

## Purpose

Provide a real-time view of the entire engineering automation system.

### Top-level metrics

```text
┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ Active     │ │ Running    │ │ PRs        │ │ Incidents  │
│ Workflows  │ │ Agents     │ │ Generated  │ │            │
│     18     │ │     11     │ │     27     │ │     2      │
└────────────┘ └────────────┘ └────────────┘ └────────────┘
```

Additional metrics:

- Requirements processed
- PRs generated
- PRs merged
- Test pass rate
- Autonomous resolution rate
- Human intervention rate
- Average cycle time
- Agent success rate
- AI cost
- Deployment success rate

---

## Active SDLC Pipeline

```text
Requirements     12
      ↓
Analysis          8
      ↓
Implementation    15
      ↓
Testing            9
      ↓
Review             7
      ↓
Ready for Merge    4
      ↓
Deployment         3
```

Each stage should be clickable.

---

## Active Workflows

Display cards:

```text
PAY-1391
Payment refund workflow

Implementation
██████████████░░ 82%

Agent: Implementation Agent
Elapsed: 18m
Status: Running

[View Workflow]
```

---

# 7. Projects Screen

## Project List

Columns:

| Project | Repositories | Active Workflows | Open PRs | Incidents | Status |
|---|---:|---:|---:|---:|---|
| Payments | 8 | 12 | 5 | 0 | Healthy |
| Patient Portal | 14 | 8 | 7 | 1 | Warning |

Actions:

```text
+ Create Project
```

---

# 8. Project Detail

Project overview:

```text
Payments Platform

Repositories
8

Services
27

Active Workflows
12

Open PRs
5

Environments
4
```

Tabs:

```text
Overview
Repositories
Workflows
Architecture
Agents
Deployments
Incidents
Knowledge
Settings
```

---

# 9. Workflow Center

The Workflow Center is the core UI of the product.

It should provide a visual representation of every active SDLC workflow.

```text
┌─────────────────────────────────────────────────────────────────┐
│ PAY-1391                                                        │
│ Implement refund processing                                     │
│                                                                 │
│ ● Requirement ──● Analysis ──● Design ──● Build                │
│                                      │                          │
│                                      ● Testing                  │
│                                      │                          │
│                                      ○ Review                   │
│                                      │                          │
│                                      ○ PR                       │
│                                      │                          │
│                                      ○ Deploy                   │
└─────────────────────────────────────────────────────────────────┘
```

Each node displays:

- Status
- Agent
- Duration
- Artifacts
- Errors
- Approval requirements

---

# 10. Workflow Detail

The workflow detail page should be the most important screen.

```text
┌──────────────────────────────────────────────────────────────────┐
│ PAY-1391                                      ● RUNNING          │
│ Implement refund processing                                      │
│                                                                  │
│ Requirement → Analysis → Design → Build → Test → Review → PR   │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│ CURRENT STAGE                                                    │
│                                                                  │
│ Implementation Agent                                             │
│                                                                  │
│ ███████████████████░░░░ 78%                                      │
│                                                                  │
│ "Implementing RefundService..."                                  │
│                                                                  │
│ Files changed: 14                                                │
│ Tests added: 8                                                   │
│ Tests passing: 8                                                 │
│                                                                  │
├───────────────────────────┬──────────────────────────────────────┤
│ Activity                  │ Artifacts                            │
│                           │                                      │
│ Agent started             │ Requirement Spec                     │
│ Analyzed PaymentService   │ Architecture Plan                   │
│ Modified RefundService    │ Implementation Plan                  │
│ Running tests             │ Test Results                         │
│                           │ Code Diff                            │
└───────────────────────────┴──────────────────────────────────────┘
```

---

# 11. Requirements Screen

The Requirements screen manages AI-generated and human-created requirements.

### Requirement states

```text
Draft
Analyzing
Needs Clarification
Ready
Approved
In Implementation
Completed
Rejected
```

### Requirement detail

```text
PAY-1391

Title
Refund processing

Business Objective
...

Acceptance Criteria
✓ Refund can be initiated
✓ Refund cannot exceed payment
✓ Duplicate refunds are prevented

AI Identified Rules
• Refund requires original transaction
• Currency must match
• Refund window = 30 days

Open Questions
⚠ Should partial refunds be supported?

[Ask Stakeholder]
[Approve Requirement]
```

---

# 12. Clarification Center

When an agent cannot safely continue, it should create a clarification request.

```text
┌─────────────────────────────────────────────┐
│ ⚠ Agent Needs Clarification                 │
│                                             │
│ PAY-1391                                    │
│                                             │
│ Question                                    │
│ Should partial refunds be supported?        │
│                                             │
│ Why this matters                            │
│ The implementation differs significantly.   │
│                                             │
│ [Yes] [No] [Provide Answer]                 │
└─────────────────────────────────────────────┘
```

Questions should be linked back to:

- Jira
- Requirement
- Agent run
- Workflow

---

# 13. Architecture Screen

The Architecture screen provides AI-generated system impact analysis.

Example:

```text
PAY-1391

Impact Analysis

Services affected       4
APIs affected            3
Database tables          5
Events                   2
Tests affected           18

┌────────────────────────────────────────────┐
│ Payment Service                            │
│        │                                   │
│        ├──── Refund Service                │
│        │           │                       │
│        │           └──── Billing DB        │
│        │                                   │
│        └──── Notification Service          │
└────────────────────────────────────────────┘
```

Tabs:

```text
Impact
Dependencies
Architecture
APIs
Database
Events
Security
Performance
```

---

# 14. Design / UX Screen

The Design screen provides AI-generated UI proposals.

```text
┌─────────────────────────────────────────────────────┐
│ Design Proposal v3                                  │
│                                                     │
│ Desktop │ Tablet │ Mobile                           │
│                                                     │
│ ┌───────────────────────────────────────────────┐   │
│ │               UI PROTOTYPE                    │   │
│ │                                               │   │
│ │ Refund Details                                │   │
│ │                                               │   │
│ │ Amount: $250                                  │   │
│ │ Reason: Duplicate transaction                 │   │
│ │                                               │   │
│ │ [ Cancel ]              [ Process Refund ]    │   │
│ └───────────────────────────────────────────────┘   │
│                                                     │
│ [Request Changes] [Approve Design]                  │
└─────────────────────────────────────────────────────┘
```

Design versions should be immutable after approval.

---

# 15. Implementation Screen

Show the agent's implementation activity.

```text
Implementation

Agent:
OpenHands / Coding Agent

Model:
GPT-5.6 Sol

Branch:
agent/PAY-1391-refund

Files:
14 modified
8 created
2 deleted

Tests:
8 added

Current Activity:

✓ Analyze repository
✓ Create implementation plan
✓ Modify RefundService
✓ Modify RefundController
● Running integration tests
○ Generate PR
```

Provide tabs:

```text
Activity
Plan
Diff
Files
Terminal
Tests
Artifacts
```

---

# 16. Agent Activity View

Users should be able to inspect an individual agent run.

```text
Agent Run #83921

Agent
Implementation Agent

Workflow
PAY-1391

Started
10:31:42

Duration
18m 42s

Model
GPT-5.6 Sol

Status
RUNNING
```

Timeline:

```text
10:31 Agent initialized
10:32 Repository analyzed
10:34 Architecture retrieved
10:37 Implementation plan generated
10:41 Code changes started
10:47 Tests started
10:50 Test failure detected
10:51 Agent analyzing failure
```

---

# 17. Agent Decision Inspector

Every important AI decision should be inspectable.

```text
Decision

Action:
Modify RefundService.java

Reason:
Existing refund validation is missing
duplicate transaction detection.

Evidence:
• PaymentService.java:143
• RefundRepository.java:87
• PAY-1221
• TestRefundService.java

Confidence:
High

Policy:
Allowed

[View Evidence]
```

Avoid exposing raw chain-of-thought.

The UI should expose **decision summaries, evidence, tool activity, artifacts, and outcomes**, not private reasoning.

---

# 18. Testing Center

The Testing Center provides unified visibility across:

```text
Unit Tests
Integration Tests
API Tests
Browser Tests
Security Tests
Performance Tests
```

Example:

```text
PAY-1391

Tests

Unit             84 / 84     ✓
Integration      32 / 32     ✓
API              18 / 18     ✓
Browser            9 / 10    ⚠
Security           7 / 7     ✓
```

---

# 19. Browser Test Viewer

For autonomous browser testing:

```text
┌────────────────────────────────────────────────────────┐
│ Test: Refund Processing                                │
│                                                        │
│ Step 1 ✓ Login                                         │
│ Step 2 ✓ Open payment                                  │
│ Step 3 ✓ Select refund                                 │
│ Step 4 ✓ Enter amount                                  │
│ Step 5 ✗ Submit refund                                 │
│                                                        │
│ ┌──────────────────────────────────────────────────┐   │
│ │              SCREENSHOT                          │   │
│ └──────────────────────────────────────────────────┘   │
│                                                        │
│ Failure Classification                                 │
│ Application defect: 82%                                │
│ Environment issue: 12%                                 │
│ Test issue: 6%                                         │
│                                                        │
│ [Investigate] [Generate Fix]                           │
└────────────────────────────────────────────────────────┘
```

---

# 20. Pull Request / Review Center

This should replicate the strongest part of the Mynt concept.

```text
PR #1821

PAY-1391 Refund processing

Status:
● AI REVIEW COMPLETE

Review lanes:

✓ Correctness
⚠ Security
✓ Dependencies
✓ Edge Cases
✓ Testing
✓ Architecture
✓ General
```

---

# 21. Review Findings

Each finding should contain:

```text
HIGH — Security

Refund endpoint does not verify
authorization against the original payment owner.

Impact
A user may potentially refund another user's payment.

Evidence
RefundController.java:84

Recommended Fix
Validate payment ownership before processing.

[Apply Fix]
[Dismiss]
[Create Jira Issue]
```

Finding classification:

```text
CRITICAL
HIGH
MEDIUM
LOW
INFO
```

And:

```text
BLOCKING
NON-BLOCKING
SUGGESTION
```

---

# 22. Autonomous Fix Loop

When findings exist:

```text
Review
  ↓
Findings
  ↓
Fix Agent
  ↓
Code changes
  ↓
Tests
  ↓
Review again
  ↓
Pass
```

UI:

```text
Review Cycle #3

Findings: 7
Fixed: 6
Remaining: 1

Iteration:
██████████████████░░

[View Changes]
[Run Again]
[Escalate]
```

---

# 23. Approval Center

All human intervention should be consolidated.

```text
Approvals

4 Pending

┌──────────────────────────────────────────────┐
│ PAY-1391                                     │
│ Approve Design                               │
│ Requested by Design Agent                    │
│                                              │
│ [Review]                                     │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ PAY-1387                                     │
│ Production Deployment                        │
│                                              │
│ Risk: Medium                                 │
│                                              │
│ [Approve] [Reject]                           │
└──────────────────────────────────────────────┘
```

---

# 24. Deployment Center

Display environments:

```text
Development
    ✓ Healthy

Testing
    ✓ Healthy

Staging
    ✓ Healthy

Production
    ⚠ Deployment in progress
```

Deployment pipeline:

```text
Build
  ✓

Deploy Staging
  ✓

Smoke Test
  ✓

Canary
  ●

Production
  ○
```

---

# 25. Production / Operations

Production screen should aggregate:

- Deployments
- Errors
- Logs
- Metrics
- Traces
- Incidents
- Agent investigations

Example:

```text
Production Health

Error Rate       0.42%
P95 Latency      420ms
Availability     99.97%

Active Incidents
2

Recent Deployments
5
```

---

# 26. Incident Center

An incident should automatically create an investigation workflow.

```text
INC-4821

Payment API elevated errors

Severity
SEV-2

Detected
12 minutes ago

AI Investigation
██████████████░░ 78%

Likely Cause
Deployment #1821

Confidence
91%

Affected Services
Payment API
Refund Service

Recommended Action
Rollback deployment #1821

[Review Investigation]
[Approve Rollback]
```

---

# 27. Knowledge Center

The Knowledge Center represents the system's engineering intelligence.

Sections:

```text
Code Intelligence
Architecture
Services
APIs
Databases
Events
Documentation
Architecture Decisions
Dependencies
Tests
```

Example:

```text
PaymentService

Owner
Payments Team

Consumers
7 services

APIs
12

Database Tables
8

Events
5

Related Jira Issues
23

Related PRs
47

Architecture Decisions
3

Tests
184
```

---

# 28. Agent Fleet

Show all agents and their current state.

```text
Agent Fleet

Requirement Agent       ● Running
Architecture Agent      ● Running
Implementation Agent    ● Running
Security Agent           ● Running
Test Agent               ● Idle
Review Agent             ● Running
Release Agent            ● Idle
Incident Agent           ● Running
```

Agent details:

```text
Agent
Security Reviewer

Model
GPT-5.6 Sol

Version
v2.4

Success Rate
96.2%

Runs
1,824

Average Duration
4m 12s
```

---

# 29. Agent / Model Configuration

Allow administrators to define:

```text
Agent
    ↓
Model
    ↓
Tools
    ↓
Skills
    ↓
Permissions
    ↓
Policies
```

Example:

```text
Implementation Agent

Primary Model
GPT-5.6 Sol

Fallback Model
Claude

Tools
✓ Git
✓ Terminal
✓ Jira
✓ Browser
✓ Knowledge Search

Permissions
✓ Feature branches
✗ Main branch
✗ Production

Approval
PR merge required
```

---

# 30. Workflow Designer

Administrators should be able to visually configure workflows.

```text
┌─────────────────────────────────────────────────────────┐
│ Workflow Designer                                       │
│                                                         │
│ Jira Event                                               │
│      ↓                                                  │
│ Requirement Agent                                       │
│      ↓                                                  │
│ Clarification? ── Yes ──► Human                         │
│      │                                                  │
│      No                                                 │
│      ↓                                                  │
│ Architecture Agent                                     │
│      ↓                                                  │
│ Implementation Agent                                   │
│      ↓                                                  │
│ Test Agent                                              │
│      ↓                                                  │
│ Review Agents                                           │
│      ↓                                                  │
│ PR                                                      │
│                                                         │
│ [Save] [Publish]                                        │
└─────────────────────────────────────────────────────────┘
```

---

# 31. Policy Center

Policies define what agents can do autonomously.

Example:

```yaml
Production Deployment

Risk: HIGH

Requires:
✓ Human approval
✓ Security review
✓ Integration tests
✓ E2E tests
✓ Staging deployment

Automatic rollback:
Enabled
```

Policies should be configurable by:

- Organization
- Project
- Repository
- Environment
- Agent
- Workflow

---

# 32. Integrations

Integration management:

```text
GitHub             ● Connected
Jira               ● Connected
Slack               ● Connected
AWS                 ● Connected
Kubernetes           ● Connected
Datadog              ● Connected
Confluence           ○ Not Connected
```

Each integration should expose:

- Connection status
- Permissions
- Available capabilities
- Last synchronization
- Health

---

# 33. Audit Log

Every autonomous action must be auditable.

Example:

```text
10:42:12
Implementation Agent

Modified:
RefundService.java

Workflow:
PAY-1391

Policy:
Implementation Policy v3

Result:
Success
```

Audit filters:

```text
Agent
User
Project
Repository
Workflow
Action
Date
Risk
```

---

# 34. Global Activity Stream

A real-time engineering event stream:

```text
10:52  ✓ PAY-1391 tests passed
10:51  ⚠ Security Agent found issue
10:49  ✓ Implementation completed
10:47  ● Browser test started
10:43  ✓ Architecture analysis completed
10:41  ✓ Requirement approved
```

Users should be able to pause, filter, and drill into any event.

---

# 35. Risk Visualization

Autonomous actions should have a visible risk level.

```text
LOW
Read repository
Run tests

MEDIUM
Modify code
Create PR
Create Jira issue

HIGH
Merge PR
Modify infrastructure
Deploy staging

CRITICAL
Deploy production
Modify production database
Change security policy
```

The UI should make high-risk actions visually prominent.

---

# 36. Recommended Dashboard Structure

The default dashboard should answer five questions immediately:

### 1. What is happening?

```text
18 active workflows
11 active agents
```

### 2. What needs me?

```text
4 approvals
2 clarifications
1 incident
```

### 3. Is engineering healthy?

```text
Tests      97.4%
Deployments 98.2%
Incidents    2
```

### 4. What is the AI doing?

```text
Requirement → Build → Test → Review
```

### 5. Is anything risky?

```text
2 high-risk actions
1 security finding
1 failed deployment
```

---

# 37. Core UI Objects

The frontend should be built around these core domain objects:

```text
Organization
Project
Repository
Environment

Requirement
Workflow
WorkflowStage
AgentRun
Agent
AgentDecision

ArchitectureArtifact
DesignArtifact
ImplementationArtifact
TestRun
Review
ReviewFinding

PullRequest
Deployment
Incident

KnowledgeEntity
ArchitectureDecision

Approval
Policy
Integration
AuditEvent
```

---

# 38. UI State Model

Every autonomous workflow should expose a consistent state:

```text
QUEUED
RUNNING
WAITING
WAITING_FOR_HUMAN
BLOCKED
FAILED
RETRYING
COMPLETED
CANCELLED
```

The UI must never hide a `WAITING` or `BLOCKED` state.

For example:

```text
WAITING FOR PM RESPONSE

The agent cannot safely continue.

Question:
Should partial refunds be supported?

[Answer Question]
```

---

# 39. Real-Time Updates

The Control Plane should use real-time event updates.

Conceptually:

```text
OpenHands
    │
    ▼
Agent Events
    │
    ▼
SDLC Event Bus
    │
    ├── Workflow State
    ├── Agent Activity
    ├── Test Results
    ├── Review Findings
    ├── Deployment Events
    └── Notifications
            │
            ▼
       Web Application
```

The UI should not rely on page refreshes for workflow state.

---

# 40. UX for Autonomous Engineering

The most important UX principle is:

> **Don't make the user watch the AI work. Make the user understand the state of the engineering system.**

Therefore avoid a UI dominated by:

```text
AI is thinking...
AI is thinking...
AI is thinking...
```

Instead show:

```text
Implementation
━━━━━━━━━━━━━━━━━━

✓ Repository analyzed
✓ Architecture analyzed
✓ Plan generated
✓ Code implemented
● Integration tests running
○ Review
○ PR
```

The agent's internal activity should be available when needed, but not overwhelm the primary workflow.

---

# 41. MVP UI Scope

For the first version, I would **not build all screens above**.

Build these first:

```text
1. Dashboard
2. Projects
3. Workflow Center
4. Workflow Detail
5. Requirements
6. Agent Activity
7. Testing
8. PR Review
9. Approval Center
10. Integrations
11. Policies
12. Audit Log
```

The MVP navigation can therefore be:

```text
Dashboard

Projects
Workflows
Requirements
Reviews
Testing
Approvals

Agents

Knowledge

Administration
  Integrations
  Policies
  Audit
```

---

# 42. MVP Primary User Journey

The most important journey should be:

```text
Jira Ticket
     ↓
SDLC Control Plane
     ↓
Requirement Analysis
     ↓
Clarification
     ↓
Architecture Analysis
     ↓
Implementation
     ↓
Testing
     ↓
AI Review
     ↓
Human Approval
     ↓
PR
```

A user should be able to open one workflow and understand the **entire journey from Jira ticket to PR** without navigating through multiple disconnected systems.

---

# 43. Long-Term Product Vision

The mature UI should eventually provide:

```text
                     SDLC CONTROL PLANE

Business Intent
       │
       ▼
┌───────────────────────────────────────────────┐
│ Requirements                                  │
│ Architecture                                  │
│ UX / Design                                   │
│ Implementation                                │
│ Testing                                       │
│ Security                                      │
│ Review                                        │
│ Release                                       │
│ Operations                                    │
└───────────────────────┬───────────────────────┘
                        │
                        ▼
                Engineering Graph
                        │
                        ▼
                  Agent Fleet
                        │
              ┌─────────┴─────────┐
              ▼                   ▼
        Autonomous Work       Human Control
```

The ultimate UI should therefore feel less like:

> **"Chat with an AI developer"**

and more like:

> **"Control and supervise an autonomous engineering organization."**

---

# 44. Recommended Frontend Architecture

At a high level:

```text
React / Next.js
       │
       ▼
SDLC Control Plane API
       │
       ├── Workflow Service
       ├── Agent Service
       ├── Requirement Service
       ├── Review Service
       ├── Testing Service
       ├── Deployment Service
       ├── Knowledge Service
       ├── Policy Service
       └── Audit Service
                 │
                 ▼
           OpenHands SDK
                 │
                 ▼
          OpenHands Runtime
```

The UI should communicate primarily with the **SDLC Control Plane API**, rather than directly coupling every screen to OpenHands.

This keeps OpenHands replaceable as the underlying agent runtime.

---

# 45. Design Goal

The final product should make this possible:

> **A product manager creates a Jira ticket. The SDLC Control Plane autonomously takes it through requirements, architecture, design, implementation, testing, review and PR creation, while humans intervene only at defined approval or ambiguity points.**

And an engineer should be able to open the Control Plane at any time and immediately answer:

```text
What is the agent doing?
Why is it doing it?
What has changed?
What evidence supports the decision?
What has been tested?
What failed?
What needs my approval?
What happens next?
```

That should be the core UX philosophy of the SDLC Control Plane.