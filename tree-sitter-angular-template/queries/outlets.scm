; Capture the name of every <router-outlet name="X"> in a template (see scripts/check-outlets).
((start_tag
   name: (tag_name) @_tag
   (attribute
     name: (attribute_name) @_attr
     value: (quoted_value (attribute_text) @name)))
 (#eq? @_tag "router-outlet")
 (#eq? @_attr "name"))
