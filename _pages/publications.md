---
layout: archive
title: "Publications"
permalink: /publications/
author_profile: true
---

{% if author.googlescholar %}
  You can also find my articles on <u><a href="{{author.googlescholar}}">my Google Scholar profile</a>.</u>
{% endif %}

{% include base_path %}

<div class="section-card">
  <strong>Publication Metrics:</strong> 20 peer-reviewed publications; 223 citations; H-index 6.
</div>

<div class="pub-list">
{% assign pubs = site.publications | sort: "date" | reverse %}
{% for post in pubs %}
  <div class="pub-card">
    <h2 class="pub-title"><a href="{{ base_path }}{{ post.url }}">{{ post.title }}</a></h2>
    {% if post.authors %}<div class="pub-authors">{{ post.authors }}</div>{% endif %}
    {% if post.venue or post.date %}
      <div class="pub-venue">{{ post.venue }}{% if post.date %} · {{ post.date | date: "%Y" }}{% endif %}</div>
    {% endif %}
    <div class="pub-links">
      {% if post.paperurl %}<a href="{{ post.paperurl }}">Paper</a>{% endif %}
      {% if post.hal %}<a href="{{ post.hal }}">HAL</a>{% endif %}
      {% if post.doi %}<a href="https://doi.org/{{ post.doi }}">DOI</a>{% endif %}
    </div>
  </div>
{% endfor %}
</div>
