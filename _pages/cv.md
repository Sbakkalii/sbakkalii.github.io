---
title: "Curriculum vitae"
permalink: /cv/
description: "CV of Souhail Bakkali: appointments, education, research, teaching, grants, supervision and service."
eyebrow: "CV"
lede: "Research scientist in Document Intelligence. The PDF has the same content in print layout."
redirect_from:
  - /resume
---

{% assign cv_peer = site.publications | where_exp: "p", "p.pub_type != 'preprint'" | where_exp: "p", "p.pub_type != 'thesis'" %}
{% assign m = site.data.profile.metrics %}

<p class="cluster" style="margin-bottom: 2rem"><a class="btn" href="/files/Sbakkali_CV-2.pdf">Download the CV (PDF)</a></p>

## Professional Summary
Enseignant-Chercheur Contractuel and Research Scientist working at the intersection of Multimodal AI, NLP, and Computer Vision. I design and lead applied research translating state-of-the-art methods into robust, scalable systems for document understanding and multimodal learning. My work includes vision-language architectures and efficient training/inference strategies, with {{ cv_peer.size }} peer-reviewed publications ({{ m.citations }} citations, h-index {{ m.h_index }}, {{ m.source }}, {{ m.as_of }}) in venues such as Pattern Recognition, WACV, and ICDAR. I have secured 501,500 EUR in competitive funding, coordinated international collaborations, and managed large-scale computing to deliver production-grade outcomes.

## Research Profile
Enseignant-Chercheur Contractuel in Computer Science specializing in multimodal document analysis, information extraction, and cross-modal learning. Research spans document classification, few-shot learning, retrieval, abstractive summarization, and document QA, with additional focus on low-resource scene-text recognition, fairness and ethics of LLMs/LMMs, data privacy, and explainability.

## Research Metrics and Impact
- Publications: {{ site.publications.size }} in total, {{ cv_peer.size }} peer-reviewed; {{ m.citations }} citations; h-index {{ m.h_index }} ({{ m.source }}, {{ m.as_of }})
- Funding secured: 501,500 EUR as PI/Co-PI
- PhD supervision: ongoing co-supervision of doctoral students
- Peer review: PR, IJCV, EAAI; PC/reviewer for ICDAR, ICPR, ICIP

## Academic Appointments
- Sep 2025 - Present: Enseignant-Chercheur Contractuel, IRISA-Lab, ESIR, Université de Rennes, France (SHADOC Team)
  - Research: Multimodal AI, document analysis and understanding, NLP, computer vision
  - Teaching: undergraduate and graduate computer science courses
- Sep 2023 - Aug 2025: Associate Professor (Maître de Conférences), L3i-Lab, La Rochelle Université, France
  - Head of course element: Advanced Database Management Systems
  - Organizer/moderator: Research Reading Group; seminars on deep multimodal learning
- Jan 2023 - Aug 2023: Postdoctoral Researcher and Lecturer, L3i-Lab, La Rochelle Université, France
  - Research: Multimodal document analysis, classification, retrieval, few-shot learning

## Research Experience
- Dec 2019 - Dec 2022: PhD Researcher and Lecturer, L3i-Lab, La Rochelle Université, France
  - Developed efficient multimodal AI frameworks for document analysis and understanding
  - Publications during PhD in Pattern Recognition, IJDAR, ICDAR, ICIP
- Feb 2019 - Jul 2019: Research Intern, L3i-Lab, La Rochelle Université
  - Face authentication with deep learning for biometric anti-fraud

## Professional Experience
- Jun 2018 - Aug 2018: Data Science Engineer (Intern), Inlog Solutions, Rabat, Morocco
  - Fingerprint verification; data mining and client segmentation
- Jun 2017 - Aug 2017: Software Developer (Intern), Lotus IT, Tangier, Morocco
  - Web development project

## Education
- Ph.D. in Computer Science and Applications, La Rochelle Université, France (2019-2022)
  - Thesis: Multimodal Document Understanding with Unified Vision and Language Cross-Modal Learning
  - European Doctorate Label (CVC, Universitat Autonoma de Barcelona)
- Engineering Degree (M.Eng) in Telecommunications Engineering and IT, INPT, Morocco (2016-2019)
- Preparatory Classes for Engineering Schools (CPGE), Al-Qalam, Morocco (2013-2016)

## Teaching Experience
- Total teaching hours: 800+ HeTD; 200+ students taught (2020-2025)
- Course coordination: Advanced Database Management Systems; Foundations of AI
- Master level: Neural Networks; Big Data Systems; Secure Networks and Storage; Web Technologies; Research and Scientific Project
- Bachelor level: Advanced Database Management Systems; Advanced Database Modeling; Intro to Computer Systems

## Student Supervision and Mentoring
- PhD co-supervision (current): topics include low-resource scene-text recognition, explainable multimodal understanding, and federated learning
- Thesis supervision: multiple M1/M2 and B3 projects across France, India, and Vietnam, with workshop publications

## Research Grants and Funding (501.5K EUR)
- PI: DocInnovate (ACI JCJC 2024), 7,000 EUR
- Co-PI: FELM (EU-CONEXUS 2025-2027), 153,000 EUR
- Co-PI: FlexChain (2025-2027), 124,000 EUR
- Co-PI: ModamPadoc (RNA-LRU 2025-2027), 120,000 EUR
- Co-PI: AI for ECO-WELLNESS (PHC PERIDOT 2024-2026), 28,000 EUR
- Additional projects: 69,500 EUR

## Publications

The complete, searchable list is on the [publications page](/publications/). By type:

{% assign cv_pubs = site.publications | sort: "date" | reverse %}
{% assign cv_kinds = "journal,conference,workshop,preprint,thesis" | split: "," %}
{% for kind in cv_kinds %}
{% assign group = cv_pubs | where: "pub_type", kind %}
{% if group.size > 0 %}
### {{ site.data.pubtypes[kind] }}{% if kind != "thesis" %}s{% endif %} ({{ group.size }})
{% for p in group %}
- {{ p.date | date: "%Y" }}: [{{ p.title }}]({{ p.url | relative_url }}) ({{ p.venue_short }})
{%- endfor %}
{% endif %}
{% endfor %}


## Research Collaborations
- International: CVC (UAB, Spain), KU Leuven (Belgium), L2TI (France), SETU (Ireland), Josef Stefan Institute (Slovenia), USTH (Vietnam), Cambodia Academy of Digital Technology, MNS University (Pakistan)
- Industry: Allread ML Technologies (Spain), Siren Company (France)

## Academic Service and Leadership
- Organizer and moderator: Research Reading Group (L3i, 2023-present)
- Organizer: Seminars on deep multimodal learning (L3i)
- Organizing committee: ICPR 2024 Call for Competitions; DAS 2022
- Peer review: PR, IJCV, EAAI, Neurocomputing; ICDAR, ICPR, ICIP, LREC-COLING

## Invited Talks and Presentations
- LORIA-Lab, Nancy: Pareto-efficient multimodal document understanding
- L3i, La Rochelle: Semantic multimodal document representation learning (2022)
- CVC, Barcelona: Multimodal document understanding

## Technical Skills
- Multimodal AI: CLIP, BLIP, LayoutLM, LLaVA; multimodal fusion; document understanding
- Computer Vision: OCR, scene-text detection/recognition, CNNs, ViTs, GANs
- NLP: GPT, BERT, T5, RoBERTa; NER, information extraction, semantic search
- MLOps/HPC: MLflow, TensorBoard, Docker, SLURM; GPU cluster administration
- Programming: Python, SQL, JavaScript, C++
- Tools: Git, Jupyter, PostgreSQL, MongoDB, Elasticsearch, FAISS, AWS, Google Cloud

## Languages
- French (fluent)
- English (fluent)
- Arabic (native)
