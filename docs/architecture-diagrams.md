# System Architecture Documentation

## Table of Contents
1. [High-Level Architecture](#high-level-architecture)
2. [Component Architecture](#component-architecture)
3. [Agent System Architecture](#agent-system-architecture)
4. [Data Flow Diagrams](#data-flow-diagrams)
5. [Database Schema](#database-schema)
6. [Deployment Architecture](#deployment-architecture)
7. [Security Architecture](#security-architecture)
8. [Integration Architecture](#integration-architecture)

---

## High-Level Architecture

### System Overview

```mermaid
graph TB
    subgraph "Client Layer"
        Mobile[Mobile App<br/>React Native]
        Web[Web Dashboard<br/>React]
        Desktop[Desktop Overlay<br/>Electron]
    end
    
    subgraph "API Gateway Layer"
        Gateway[API Gateway<br/>Load Balancer]
        Auth[Authentication<br/>Service]
    end
    
    subgraph "Application Layer"
        FastAPI[Fast Response<br/>Service]
        AgentAPI[Agent<br/>Service]
        UserAPI[User<br/>Service]
        GameAPI[Game Integration<br/>Service]
    end
    
    subgraph "Agent Layer"
        Orchestrator[Agent<br/>Orchestrator]
        ToolRegistry[Tool<br/>Registry]
        Workflows[Workflow<br/>Engine]
    end
    
    subgraph "Data Layer"
        Postgres[(PostgreSQL<br/>Primary DB)]
        Redis[(Redis<br/>Cache & Queue)]
        Vector[(Vector DB<br/>Embeddings)]
        S3[(S3/Storage<br/>Files)]
    end
    
    subgraph "External Services"
        Claude[Anthropic<br/>Claude API]
        RiotAPI[Riot Games<br/>API]
        SteamAPI[Steam<br/>API]
        Search[Web Search<br/>API]
    end
    
    Mobile --> Gateway
    Web --> Gateway
    Desktop --> Gateway
    
    Gateway --> Auth
    Auth --> FastAPI
    Auth --> AgentAPI
    Auth --> UserAPI
    Auth --> GameAPI
    
    FastAPI --> Redis
    FastAPI --> Vector
    FastAPI --> Claude
    
    AgentAPI --> Orchestrator
    Orchestrator --> ToolRegistry
    Orchestrator --> Workflows
    
    ToolRegistry --> Claude
    ToolRegistry --> RiotAPI
    ToolRegistry --> SteamAPI
    ToolRegistry --> Search
    
    UserAPI --> Postgres
    GameAPI --> Postgres
    GameAPI --> RiotAPI
    GameAPI --> SteamAPI
    
    AgentAPI --> Redis
    AgentAPI --> Postgres
    
    Workflows --> Redis
    Workflows --> Postgres
    
    style Claude fill:#191919,color:#fff
    style Mobile fill:#61DAFB,color:#000
    style Web fill:#61DAFB,color:#000
    style Postgres fill:#336791,color:#fff
    style Redis fill:#DC382D,color:#fff
```

### Architecture Principles

1. **Separation of Concerns**: Fast responses and agentic tasks are handled by separate services
2. **Scalability**: Horizontal scaling for API and agent services
3. **Resilience**: Circuit breakers, retries, and fallback mechanisms
4. **Security**: Authentication at gateway, encrypted data at rest and in transit
5. **Observability**: Comprehensive logging, metrics, and tracing

---

## Component Architecture

### Layered Architecture

```mermaid
graph TB
    subgraph "Presentation Layer"
        UI[User Interface Components]
        State[State Management]
        Routing[Routing & Navigation]
    end
    
    subgraph "API/Service Layer"
        APIClient[API Client]
        WebSocket[WebSocket Client]
        AuthService[Auth Service]
    end
    
    subgraph "Business Logic Layer"
        Controllers[Controllers]
        Services[Business Services]
        Validators[Input Validators]
    end
    
    subgraph "Agent Logic Layer"
        AgentCore[Agent Core Engine]
        ToolManager[Tool Manager]
        WorkflowManager[Workflow Manager]
        StateManager[State Manager]
    end
    
    subgraph "Data Access Layer"
        Repositories[Data Repositories]
        ORMLayer[ORM Layer]
        CacheLayer[Cache Layer]
    end
    
    subgraph "Infrastructure Layer"
        Database[(Database)]
        Cache[(Cache)]
        Queue[(Message Queue)]
        Storage[(Object Storage)]
    end
    
    UI --> APIClient
    State --> APIClient
    APIClient --> Controllers
    WebSocket --> Controllers
    
    Controllers --> Services
    Services --> Validators
    Services --> AgentCore
    
    AgentCore --> ToolManager
    AgentCore --> WorkflowManager
    AgentCore --> StateManager
    
    Services --> Repositories
    AgentCore --> Repositories
    
    Repositories --> ORMLayer
    ORMLayer --> Database
    
    Repositories --> CacheLayer
    CacheLayer --> Cache
    
    WorkflowManager --> Queue
    StateManager --> Cache
```

### Component Responsibilities

| Layer | Components | Responsibilities |
|-------|-----------|------------------|
| **Presentation** | UI, State, Routing | User interaction, display logic, navigation |
| **API/Service** | API Client, WebSocket | Communication with backend, real-time updates |
| **Business Logic** | Controllers, Services | Business rules, orchestration, validation |
| **Agent Logic** | Agent Core, Tools, Workflows | AI reasoning, tool execution, task management |
| **Data Access** | Repositories, ORM | Data persistence, caching, queries |
| **Infrastructure** | Database, Cache, Queue | Data storage, message passing, file storage |

---

## Agent System Architecture

### Agent Execution Flow

```mermaid
sequenceDiagram
    participant User
    participant API as API Gateway
    participant Router as Task Router
    participant Agent as Agent Orchestrator
    participant LLM as Claude API
    participant Tools as Tool Registry
    participant DB as Database
    participant Cache as Redis Cache
    
    User->>API: Submit Analysis Request
    API->>Router: Route to Agent Service
    Router->>Agent: Create Task
    Agent->>DB: Create Task State
    Agent->>Cache: Initialize Context
    
    loop Agent Reasoning Loop
        Agent->>LLM: Send Task + Context + Available Tools
        LLM-->>Agent: Thought + Tool Selection
        
        alt Tool Call Required
            Agent->>Tools: Execute Tool
            Tools->>DB: Fetch Data / Call External API
            DB-->>Tools: Return Data
            Tools-->>Agent: Tool Result
            Agent->>Cache: Update Context
            Agent->>LLM: Send Tool Result
        else Task Complete
            LLM-->>Agent: Final Answer
            Agent->>DB: Save Result
            Agent->>Cache: Clear Context
        end
    end
    
    Agent-->>API: Return Result
    API-->>User: Display Analysis
    
    Note over Agent,LLM: Max 10-20 iterations with timeout protection
```

### Agent State Machine

```mermaid
stateDiagram-v2
    [*] --> Initialized
    Initialized --> Planning: Start Task
    Planning --> ToolSelection: Tools Identified
    ToolSelection --> ExecutingTool: Tool Selected
    ExecutingTool --> ProcessingResult: Tool Complete
    ProcessingResult --> ToolSelection: Need More Data
    ProcessingResult --> Synthesizing: All Data Gathered
    Synthesizing --> Completed: Success
    Synthesizing --> PartialSuccess: Timeout/Error with Partial Data
    ExecutingTool --> Failed: Critical Error
    Planning --> Failed: Invalid Task
    Completed --> [*]
    PartialSuccess --> [*]
    Failed --> [*]
    
    note right of Planning
        Agent creates execution plan
        Identifies required tools
    end note
    
    note right of ExecutingTool
        Retry logic active
        Circuit breaker monitoring
    end note
    
    note right of Synthesizing
        Combines all results
        Generates final response
    end note
```

### Tool Execution Architecture

```mermaid
graph LR
    subgraph "Tool Interface Layer"
        ToolBase[Base Tool Interface]
        Schema[Tool Schema Definition]
    end
    
    subgraph "Core Tools"
        GameAPI[Game API Tool]
        WebSearch[Web Search Tool]
        DBQuery[Database Query Tool]
        Analytics[Analytics Calculator]
        Knowledge[Knowledge Base Tool]
    end
    
    subgraph "Tool Middleware"
        RateLimiter[Rate Limiter]
        CircuitBreaker[Circuit Breaker]
        RetryLogic[Retry Handler]
        Cache[Result Cache]
        Logger[Tool Logger]
    end
    
    subgraph "External Resources"
        APIs[External APIs]
        DB[(Database)]
        VectorDB[(Vector DB)]
    end
    
    ToolBase --> GameAPI
    ToolBase --> WebSearch
    ToolBase --> DBQuery
    ToolBase --> Analytics
    ToolBase --> Knowledge
    
    GameAPI --> RateLimiter
    WebSearch --> RateLimiter
    DBQuery --> Cache
    
    RateLimiter --> CircuitBreaker
    CircuitBreaker --> RetryLogic
    RetryLogic --> Logger
    
    GameAPI --> APIs
    WebSearch --> APIs
    DBQuery --> DB
    Knowledge --> VectorDB
    
    style ToolBase fill:#4A90E2,color:#fff
    style RateLimiter fill:#F5A623,color:#000
    style CircuitBreaker fill:#F5A623,color:#000
```

---

## Data Flow Diagrams

### User Query Flow (Fast Response)

```mermaid
flowchart TD
    Start([User Asks Question]) --> CheckAuth{Authenticated?}
    CheckAuth -->|No| Login[Redirect to Login]
    CheckAuth -->|Yes| CheckCache{In Cache?}
    
    CheckCache -->|Yes| ReturnCached[Return Cached Response]
    CheckCache -->|No| CheckKnowledge{In Knowledge Base?}
    
    CheckKnowledge -->|Yes| RetrieveKB[Retrieve from Vector DB]
    CheckKnowledge -->|No| SimpleLLM[Query Claude Haiku]
    
    RetrieveKB --> FormatResponse[Format Response]
    SimpleLLM --> FormatResponse
    
    FormatResponse --> StoreCache[Store in Cache]
    StoreCache --> LogMetrics[Log Metrics]
    LogMetrics --> End([Return to User])
    ReturnCached --> End
    
    style CheckCache fill:#50E3C2,color:#000
    style SimpleLLM fill:#191919,color:#fff
    style End fill:#7ED321,color:#000
```

### Agent Analysis Flow (Deep Analysis)

```mermaid
flowchart TD
    Start([User Requests Analysis]) --> ValidateRequest{Valid Request?}
    ValidateRequest -->|No| Error[Return Error]
    ValidateRequest -->|Yes| CheckBudget{Within Budget?}
    
    CheckBudget -->|No| UpgradePrompt[Suggest Upgrade]
    CheckBudget -->|Yes| CreateTask[Create Task State]
    
    CreateTask --> InitAgent[Initialize Agent]
    InitAgent --> AgentLoop{Agent Iteration}
    
    AgentLoop --> LLMReason[LLM Reasoning]
    LLMReason --> NeedTool{Tool Needed?}
    
    NeedTool -->|Yes| SelectTool[Select Tool]
    SelectTool --> ExecuteTool[Execute Tool]
    ExecuteTool --> CheckToolResult{Success?}
    
    CheckToolResult -->|No| RetryTool{Retry?}
    RetryTool -->|Yes| ExecuteTool
    RetryTool -->|No| FallbackData[Use Fallback]
    
    CheckToolResult -->|Yes| UpdateContext[Update Context]
    FallbackData --> UpdateContext
    UpdateContext --> CheckComplete{Task Complete?}
    
    CheckComplete -->|No| CheckIterations{Max Iterations?}
    CheckIterations -->|No| AgentLoop
    CheckIterations -->|Yes| PartialResult[Generate Partial Result]
    
    NeedTool -->|No| CheckComplete
    CheckComplete -->|Yes| GenerateReport[Generate Final Report]
    
    GenerateReport --> SaveResult[Save to Database]
    PartialResult --> SaveResult
    SaveResult --> NotifyUser[Notify User]
    NotifyUser --> End([Return Result])
    
    Error --> End
    UpgradePrompt --> End
    
    style CreateTask fill:#4A90E2,color:#fff
    style ExecuteTool fill:#F5A623,color:#000
    style GenerateReport fill:#7ED321,color:#000
    style End fill:#7ED321,color:#000
```

### Match Analysis Workflow

```mermaid
flowchart LR
    Start([Match Analysis Request]) --> Fetch[Fetch Match History]
    Fetch --> Parse[Parse Match Data]
    Parse --> CalcStats[Calculate Statistics]
    
    CalcStats --> Parallel{Parallel Processing}
    
    Parallel --> PatternAnalysis[Pattern Detection]
    Parallel --> Comparison[Compare to Rank Average]
    Parallel --> ChampionAnalysis[Champion Performance]
    
    PatternAnalysis --> Synthesize[Synthesize Findings]
    Comparison --> Synthesize
    ChampionAnalysis --> Synthesize
    
    Synthesize --> SearchTips[Search Improvement Tips]
    SearchTips --> GenerateRecs[Generate Recommendations]
    GenerateRecs --> FormatReport[Format Report]
    FormatReport --> End([Return to User])
    
    style Parallel fill:#F5A623,color:#000
    style Synthesize fill:#4A90E2,color:#fff
    style End fill:#7ED321,color:#000
```

---

## Database Schema

### Entity Relationship Diagram

```mermaid
erDiagram
    USERS ||--o{ PLAYER_PROFILES : has
    USERS ||--o{ SUBSCRIPTIONS : has
    USERS ||--o{ AGENT_TASKS : creates
    USERS ||--o{ API_USAGE : tracks
    
    PLAYER_PROFILES ||--o{ MATCH_HISTORY : contains
    PLAYER_PROFILES ||--o{ PLAYER_STATS : tracks
    PLAYER_PROFILES }o--|| GAMES : for
    
    AGENT_TASKS ||--o{ TASK_STEPS : contains
    AGENT_TASKS ||--o{ TASK_RESULTS : produces
    
    MATCH_HISTORY ||--o{ MATCH_STATS : has
    
    USERS {
        uuid id PK
        string email UK
        string password_hash
        string name
        timestamp created_at
        timestamp last_login
        enum status
    }
    
    SUBSCRIPTIONS {
        uuid id PK
        uuid user_id FK
        enum tier
        decimal monthly_limit
        decimal current_usage
        timestamp start_date
        timestamp end_date
        boolean active
    }
    
    PLAYER_PROFILES {
        uuid id PK
        uuid user_id FK
        uuid game_id FK
        string player_id
        string summoner_name
        string rank
        string main_role
        json preferences
        timestamp created_at
        timestamp updated_at
    }
    
    GAMES {
        uuid id PK
        string name
        string slug
        string api_provider
        json api_config
        boolean active
    }
    
    MATCH_HISTORY {
        uuid id PK
        uuid profile_id FK
        string match_id UK
        timestamp match_date
        string game_mode
        integer duration
        boolean win
        json raw_data
        timestamp fetched_at
    }
    
    MATCH_STATS {
        uuid id PK
        uuid match_id FK
        integer kills
        integer deaths
        integer assists
        decimal kda
        integer cs
        integer vision_score
        decimal damage_dealt
        json detailed_stats
    }
    
    PLAYER_STATS {
        uuid id PK
        uuid profile_id FK
        date period_start
        date period_end
        decimal win_rate
        decimal avg_kda
        integer total_matches
        json aggregated_stats
        timestamp calculated_at
    }
    
    AGENT_TASKS {
        uuid id PK
        uuid user_id FK
        string task_type
        enum status
        json parameters
        json context
        integer iterations
        timestamp created_at
        timestamp completed_at
    }
    
    TASK_STEPS {
        uuid id PK
        uuid task_id FK
        integer step_number
        string step_type
        string tool_name
        json tool_params
        json tool_result
        boolean success
        timestamp executed_at
    }
    
    TASK_RESULTS {
        uuid id PK
        uuid task_id FK
        json result_data
        json sources
        integer tokens_used
        decimal cost
        timestamp created_at
    }
    
    API_USAGE {
        uuid id PK
        uuid user_id FK
        string api_name
        integer request_count
        integer tokens_used
        decimal cost
        date usage_date
    }
```

### Key Tables Description

| Table | Purpose | Key Relationships |
|-------|---------|-------------------|
| **USERS** | Core user accounts | Links to all user-specific data |
| **SUBSCRIPTIONS** | Billing and tier management | One per active user |
| **PLAYER_PROFILES** | Game-specific player data | Multiple profiles per user per game |
| **MATCH_HISTORY** | Raw match data from APIs | Linked to player profiles |
| **AGENT_TASKS** | Track agent executions | Contains all task metadata |
| **TASK_STEPS** | Individual agent steps | Detailed execution trail |
| **TASK_RESULTS** | Final agent outputs | Synthesized results and costs |

---

## Deployment Architecture

### Production Infrastructure

```mermaid
graph TB
    subgraph "CDN Layer"
        CloudFlare[CloudFlare CDN]
    end
    
    subgraph "Load Balancer"
        ALB[Application Load Balancer<br/>AWS ALB / Nginx]
    end
    
    subgraph "Application Tier - Auto Scaling Group"
        API1[API Server 1<br/>4 vCPU, 8GB RAM]
        API2[API Server 2<br/>4 vCPU, 8GB RAM]
        API3[API Server N<br/>4 vCPU, 8GB RAM]
    end
    
    subgraph "Worker Tier - Auto Scaling Group"
        Worker1[Agent Worker 1<br/>8 vCPU, 16GB RAM]
        Worker2[Agent Worker 2<br/>8 vCPU, 16GB RAM]
        Worker3[Agent Worker N<br/>8 vCPU, 16GB RAM]
    end
    
    subgraph "Data Tier"
        RDS[(RDS PostgreSQL<br/>Multi-AZ<br/>Read Replicas)]
        ElastiCache[(ElastiCache Redis<br/>Cluster Mode)]
        S3[(S3 Bucket<br/>Versioned)]
    end
    
    subgraph "Message Queue"
        SQS[AWS SQS / RabbitMQ]
    end
    
    subgraph "Monitoring"
        CloudWatch[CloudWatch /<br/>DataDog]
        Sentry[Sentry<br/>Error Tracking]
    end
    
    CloudFlare --> ALB
    ALB --> API1
    ALB --> API2
    ALB --> API3
    
    API1 --> SQS
    API2 --> SQS
    API3 --> SQS
    
    SQS --> Worker1
    SQS --> Worker2
    SQS --> Worker3
    
    API1 --> RDS
    API2 --> RDS
    API3 --> RDS
    
    API1 --> ElastiCache
    API2 --> ElastiCache
    API3 --> ElastiCache
    
    Worker1 --> RDS
    Worker2 --> RDS
    Worker3 --> RDS
    
    Worker1 --> ElastiCache
    Worker2 --> ElastiCache
    Worker3 --> ElastiCache
    
    API1 --> S3
    Worker1 --> S3
    
    API1 --> CloudWatch
    Worker1 --> CloudWatch
    API1 --> Sentry
    Worker1 --> Sentry
    
    style API1 fill:#FF9900,color:#000
    style Worker1 fill:#FF9900,color:#000
    style RDS fill:#336791,color:#fff
    style ElastiCache fill:#DC382D,color:#fff
```

### Container Architecture (Docker/Kubernetes)

```mermaid
graph TB
    subgraph "Kubernetes Cluster"
        subgraph "Ingress"
            Ingress[Nginx Ingress Controller]
        end
        
        subgraph "API Namespace"
            APIPod1[API Pod 1]
            APIPod2[API Pod 2]
            APIService[API Service<br/>Load Balancer]
        end
        
        subgraph "Worker Namespace"
            WorkerPod1[Worker Pod 1]
            WorkerPod2[Worker Pod 2]
            WorkerService[Worker Service]
        end
        
        subgraph "Storage"
            PVC[Persistent Volume Claims]
        end
        
        subgraph "Config"
            ConfigMap[ConfigMaps]
            Secrets[Secrets]
        end
    end
    
    subgraph "External Services"
        ExternalDB[(External RDS)]
        ExternalRedis[(External Redis)]
    end
    
    Ingress --> APIService
    APIService --> APIPod1
    APIService --> APIPod2
    
    APIPod1 --> ExternalDB
    APIPod1 --> ExternalRedis
    APIPod2 --> ExternalDB
    APIPod2 --> ExternalRedis
    
    WorkerPod1 --> ExternalDB
    WorkerPod1 --> ExternalRedis
    WorkerPod2 --> ExternalDB
    WorkerPod2 --> ExternalRedis
    
    APIPod1 -.-> ConfigMap
    APIPod1 -.-> Secrets
    WorkerPod1 -.-> ConfigMap
    WorkerPod1 -.-> Secrets
    
    APIPod1 --> PVC
    WorkerPod1 --> PVC
    
    style Ingress fill:#326CE5,color:#fff
    style APIPod1 fill:#326CE5,color:#fff
    style WorkerPod1 fill:#326CE5,color:#fff
```

---

## Security Architecture

### Authentication & Authorization Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Gateway as API Gateway
    participant Auth as Auth Service
    participant JWT as JWT Validator
    participant API as Backend API
    participant DB as Database
    
    User->>Frontend: Login (email, password)
    Frontend->>Gateway: POST /auth/login
    Gateway->>Auth: Validate credentials
    Auth->>DB: Query user
    DB-->>Auth: User data
    Auth->>Auth: Verify password hash
    Auth->>Auth: Generate JWT + Refresh Token
    Auth-->>Gateway: Tokens + User data
    Gateway-->>Frontend: Tokens
    Frontend->>Frontend: Store tokens (secure)
    
    Note over User,Frontend: Subsequent Requests
    
    User->>Frontend: Make API request
    Frontend->>Gateway: Request + JWT in header
    Gateway->>JWT: Validate JWT
    JWT->>JWT: Check signature, expiry
    JWT-->>Gateway: Valid + User context
    Gateway->>API: Forward request + User context
    API->>API: Check permissions
    API->>DB: Execute query
    DB-->>API: Data
    API-->>Gateway: Response
    Gateway-->>Frontend: Response
    Frontend-->>User: Display data
```

### Security Layers

```mermaid
graph TD
    subgraph "Edge Security"
        WAF[Web Application Firewall]
        DDoS[DDoS Protection]
        RateLimit[Rate Limiting]
    end
    
    subgraph "Network Security"
        VPC[VPC / Private Network]
        SecurityGroups[Security Groups]
        NetworkACL[Network ACLs]
    end
    
    subgraph "Application Security"
        InputVal[Input Validation]
        CSRF[CSRF Protection]
        XSS[XSS Prevention]
        SQLInj[SQL Injection Prevention]
    end
    
    subgraph "Authentication"
        OAuth[OAuth 2.0]
        JWT[JWT Tokens]
        MFA[Multi-Factor Auth]
    end
    
    subgraph "Data Security"
        EncryptTransit[TLS/HTTPS]
        EncryptRest[Encryption at Rest]
        Secrets[Secrets Management]
    end
    
    subgraph "Monitoring"
        AuditLog[Audit Logging]
        SIEM[Security Monitoring]
        Alerts[Alert System]
    end
    
    WAF --> VPC
    DDoS --> VPC
    RateLimit --> VPC
    
    VPC --> SecurityGroups
    SecurityGroups --> NetworkACL
    
    NetworkACL --> InputVal
    InputVal --> CSRF
    CSRF --> XSS
    XSS --> SQLInj
    
    SQLInj --> OAuth
    OAuth --> JWT
    JWT --> MFA
    
    MFA --> EncryptTransit
    EncryptTransit --> EncryptRest
    EncryptRest --> Secrets
    
    Secrets --> AuditLog
    AuditLog --> SIEM
    SIEM --> Alerts
    
    style WAF fill:#E74C3C,color:#fff
    style OAuth fill:#27AE60,color:#fff
    style EncryptRest fill:#3498DB,color:#fff
```

---

## Integration Architecture

### External API Integration Pattern

```mermaid
flowchart TD
    Start[API Request] --> RateLimitCheck{Rate Limit OK?}
    
    RateLimitCheck -->|No| RateLimitError[Return 429 Error]
    RateLimitCheck -->|Yes| CircuitCheck{Circuit Open?}
    
    CircuitCheck -->|Yes| CircuitError[Return 503 Error]
    CircuitCheck -->|No| CacheCheck{In Cache?}
    
    CacheCheck -->|Yes| ReturnCache[Return Cached Data]
    CacheCheck -->|No| MakeRequest[Make API Request]
    
    MakeRequest --> RequestSuccess{Success?}
    
    RequestSuccess -->|Yes| ValidateResponse[Validate Response]
    RequestSuccess -->|No| RetryCheck{Retry?}
    
    RetryCheck -->|Yes| BackoffWait[Exponential Backoff]
    BackoffWait --> MakeRequest
    RetryCheck -->|No| LogError[Log Error]
    
    ValidateResponse --> TransformData[Transform Data]
    TransformData --> CacheResult[Cache Result]
    CacheResult --> UpdateMetrics[Update Metrics]
    UpdateMetrics --> ReturnData[Return Data]
    
    LogError --> CircuitUpdate[Update Circuit Breaker]
    CircuitUpdate --> FallbackCheck{Fallback Available?}
    
    FallbackCheck -->|Yes| UseFallback[Use Fallback Data]
    FallbackCheck -->|No| ReturnError[Return Error]
    
    UseFallback --> ReturnData
    ReturnCache --> End[Complete]
    ReturnData --> End
    ReturnError --> End
    RateLimitError --> End
    CircuitError --> End
    
    style MakeRequest fill:#3498DB,color:#fff
    style CacheResult fill:#27AE60,color:#fff
    style ReturnError fill:#E74C3C,color:#fff
```

### Webhook Processing

```mermaid
sequenceDiagram
    participant External as External Service
    participant Webhook as Webhook Endpoint
    participant Queue as Message Queue
    participant Worker as Background Worker
    participant DB as Database
    participant User as User Notification
    
    External->>Webhook: POST webhook event
    Webhook->>Webhook: Validate signature
    Webhook->>Webhook: Quick validation
    Webhook->>Queue: Enqueue for processing
    Webhook-->>External: 200 OK (immediate)
    
    Queue->>Worker: Dequeue event
    Worker->>Worker: Process event
    Worker->>DB: Update data
    Worker->>DB: Create notification
    Worker->>User: Send notification (push/email)
    
    Note over Worker: Async processing prevents<br/>webhook timeouts
```

---

## Performance Optimization

### Caching Strategy

```mermaid
graph LR
    subgraph "Cache Layers"
        Browser[Browser Cache<br/>Static Assets]
        CDN[CDN Cache<br/>Images, JS, CSS]
        AppCache[Application Cache<br/>Redis]
        DBCache[Database Query Cache]
    end
    
    subgraph "Cache Types"
        Static[Static Content<br/>24 hours]
        API[API Responses<br/>5-60 minutes]
        Session[Session Data<br/>Per session]
        Computed[Computed Results<br/>1-24 hours]
    end
    
    Browser --> Static
    CDN --> Static
    AppCache --> API
    AppCache --> Session
    AppCache --> Computed
    DBCache --> Computed
    
    style Browser fill:#3498DB,color:#fff
    style AppCache fill:#E67E22,color:#fff
    style Computed fill:#27AE60,color:#fff
```

### Scaling Strategy

| Component | Scaling Type | Trigger | Max Instances |
|-----------|--------------|---------|---------------|
| API Servers | Horizontal | CPU > 70% | 10 |
| Agent Workers | Horizontal | Queue depth > 50 | 20 |
| Database | Vertical + Read Replicas | Connections > 80% | 1 primary + 5 replicas |
| Redis | Horizontal (Cluster) | Memory > 75% | 6 nodes |

---

## Appendix

### Technology Stack Summary

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React / React Native | User interface |
| **API Gateway** | Nginx / AWS ALB | Load balancing, SSL termination |
| **Backend** | Node.js / Python FastAPI | Application logic |
| **Agent Engine** | Python + Claude API | AI reasoning and tools |
| **Database** | PostgreSQL | Primary data store |
| **Cache** | Redis | Session, cache, queue |
| **Vector DB** | Pinecone / Weaviate | Embeddings for knowledge base |
| **Storage** | AWS S3 | File storage |
| **Queue** | AWS SQS / RabbitMQ | Async task processing |
| **Monitoring** | DataDog / CloudWatch | Metrics and logging |
| **Error Tracking** | Sentry | Error monitoring |

### Architecture Decision Records (ADRs)

**ADR-001: Separate Fast and Agent Services**
- **Decision**: Split into fast response and agentic layers
- **Rationale**: Different latency requirements and resource needs
- **Status**: Accepted

**ADR-002: Use PostgreSQL for Primary Database**
- **Decision**: PostgreSQL instead of MongoDB
- **Rationale**: Strong ACID guarantees, JSON support, mature ecosystem
- **Status**: Accepted

**ADR-003: Claude API as Primary LLM**
- **Decision**: Anthropic Claude for agent reasoning
- **Rationale**: Strong tool use, long context window, cost-effective
- **Status**: Accepted

**ADR-004: Redis for Caching and Queue**
- **Decision**: Redis for both cache and message queue
- **Rationale**: Proven performance, simple deployment, versatile
- **Status**: Accepted

---

**Last Updated**: November 2025  
**Document Version**: 1.0  
**Maintained By**: Engineering Team