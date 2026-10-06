# Dash — AI Chief of Staff

Un tableau de bord qui répond en permanence à deux questions : **qu'est-ce que Rémi doit faire ?** et **qu'est-ce que l'IA doit faire ?**

Chaque tâche est classée selon *qui* l'exécute (`YOU`, `AI`, `AI + YOU`, `WAITING`), reçoit un potentiel d'automatisation (0–100 %), une valeur humaine (1–5) et un niveau de risque. Le travail délégable part vers une équipe d'agents spécialisés ; le travail qui exige ta présence, ton jugement ou une relation remonte en haut, sous **YOUR NEXT MOVE**.

## Démarrer

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # classificateur + planificateur (node:test)
npm run lint         # typecheck
```

Node ≥ 22.13 (utilise `node:sqlite`, intégré). La base est créée dans `data/dash.db` au premier lancement et remplie avec un espace de démo (Patrick Pons, Jobsy, Kopi, AI Video Editor, Plug Leak). `⌘K → Reset demo workspace` la réinitialise.

### Avec Claude (optionnel)

```bash
ANTHROPIC_API_KEY=… npm run dev
```

- La classification des nouvelles tâches est affinée par Claude (sortie JSON structurée) ; sans clé, un classificateur heuristique FR/EN prend le relais.
- Les agents textuels (Research, Content, Design, Analyst, Operations) produisent de vrais livrables (Research/Analyst avec recherche web).
- `DASH_MODEL` permet de changer de modèle (défaut `claude-opus-5-5`).

## Ce qui est réel, ce qui est simulé

| Brique | État |
|---|---|
| Classification YOU / AI / AI+YOU / WAITING, automatisation, valeur humaine, risque | Réel (heuristique déterministe, testé ; Claude si clé) |
| Priorisation, next move, plan de la journée, re-planification | Réel (`lib/planner.ts`) |
| Table `agent_jobs` + statuts QUEUED → RUNNING → WAITING_FOR_APPROVAL → COMPLETED / FAILED / CANCELLED | Réel (`db/schema.sql`) |
| Approbations par niveau de risque (low auto, medium après, high avant + après) | Réel |
| Missions chaînées (ex. « Get a new client » → 6 étapes IA puis 4 étapes humaines), déblocage des dépendances, handoff IA → toi | Réel |
| Opportunités proactives (case study, post-launch, projet bloqué), relances automatiques des tâches en attente | Réel (règles) |
| Exécution des agents textuels | Réel avec clé API, sinon **simulée** et étiquetée comme telle |
| Coding Agent qui modifie un vrai repo | **Non implémenté** — toujours simulé. Il faut un runner isolé (Claude Agent SDK ou session Claude Code distante) avec accès au repo et validation humaine avant merge. |
| « AI saved you » | Estimation : temps manuel estimé − ton implication, par job accepté. Directionnel, pas une mesure. |

Vitesse de simulation : 1 minute d'agent = 3 s (`simSecondsPerMinute` dans les settings).

## Architecture

```
lib/
  types.ts         modèle de domaine (Task, AgentJob, Project, Opportunity…)
  classifier.ts    qui exécute quoi — pur, partagé client/serveur
  planner.ts       next move, workforce, plan du jour, pipeline, briefings, découvertes
  agents.ts        les 6 agents spécialisés
  server/
    engine.ts      boucle OBSERVE → … → REPLAN ; toutes les actions
    db.ts          état en mémoire + écriture SQLite transactionnelle
    claude.ts      classification et exécution via l'API Claude
    seed.ts        espace de démo, relatif à l'heure courante
app/api/state      GET  — fait avancer la boucle puis renvoie l'état
app/api/action     POST — dispatch d'une action typée
components/        UI (Next.js 16, Tailwind 4, Motion)
```

La progression d'un job simulé est une fonction du temps écoulé : pas de scheduler en arrière-plan, chaque lecture fait avancer l'état.

## Motion

- Entrée du dashboard en cascade (< 1 s), animations `transform`/`opacity` uniquement.
- **What should I do?** (signature) : états de réflexion contextuels, le travail humain monte, l'IA s'écarte, le bloqué recule, puis une seule action se résout.
- Réordonnancement FLIP (`layout`), carte qui vole de YOU vers AI lors d'une délégation (`layoutId`), séquence `Owner: You → Owner: AI → Agent → Running`.
- Complétion (check qui se dessine), bannière *Newly unlocked*, handoff *AI preparation complete → Your turn*.
- Next move : lumière ambiante lente, profondeur au curseur (≤ 3 px), expansion en Focus Mode par élément partagé.
- `prefers-reduced-motion` respecté (MotionConfig + CSS).

## Raccourcis

`⌘K` palette · `N` nouvelle tâche · `Esc` fermer · glisser-déposer pour réordonner la colonne YOU.

## Limites connues

- SQLite local : ne persiste pas sur un hébergement serverless (Vercel). Pour déployer, remplacer `lib/server/db.ts` par Postgres.
- Mono-utilisateur, sans authentification.
- Le système n'« observe » que ce qui est dans l'app : pas encore de connecteurs (calendrier, email, GitHub). Sans eux, la boucle OBSERVE dépend de ce que tu saisis.
