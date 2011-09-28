
var loader = new Loading();
var loading_small = new LoadingSmall();
/*
  =================================
*/
var FusionTablesLayer = Backbone.View.extend({

    initialize: function() {
        _.bindAll(this, 'click_on_polygon');
        var self = this;
        this.mapview = this.options.mapview;
        this.google_maps_layer = this.options.layer;
        this.google_maps_layer.setOptions({suppressInfoWindows: true});
        this.table = this.options.table;

        google.maps.event.addListener(this.google_maps_layer, "click", function(event) {
            self.click_on_polygon(event);
        });

    },

    click_on_polygon: function(poly) {
        poly.table = this.table;
        this.trigger('polygon_click', poly);
    }


});

/*
  ===============================
  controls the box on top right
  ===============================
*/

var StatiticsInfo = Backbone.View.extend({
    el: $('#overview'),

    events: {
       'click #report_done': 'show_report'
    },

    initialize: function() {
        _.bindAll(this, 'set_info', 'set_location', 'show_report', 'range_change');
        this.area_info = this.$(".stats");
        this.location = this.$("#current_cell");
    },

    set_info: function(deforested_area, degradated_area) {
        this.area_info.html(deforested_area + " " + degradated_area);
    },

    set_location: function(loc) {
        this.location.html(loc);
     },

    show_report: function(e) {
        if(e) e.preventDefault();
        this.trigger('show_report');
    },

    range_change: function(reports) {
        this.location.html("All areas " + _(reports).reduce(function(total, r) {
            return total + r.get('deforestation') + r.get('degradation');
        }, 0) + "km2");
    }
});

var Toolbar = Backbone.View.extend({

    el: $('#tools'),

    initialize: function() {
        _.bindAll(this, 'change_state');
        this.el.show();
        this.$('#work_toolbar').show();
        this.buttons = new ButtonGroup({el: $('#selection')});

        this.draw_tool = this.options.draw_tool;
        this.buttons.bind('state', this.change_state);
        
    },

    change_state: function(state) {
        switch(state) {
            case 'draw':
                this.draw_tool.editing_state(true);
                break;
            case 'edit':
                this.draw_tool.editing_state(false);
                break;
        }
    }


});


/*
 =======================
 main app
 =======================
*/

var Vizzualization = Backbone.View.extend({
    REPORT_LAYERS: [
      'Legal Amazon',
      'Municipalities',
      'States',
      'Federal Conservation',
      'State Conservation'
    ],

    el: $('body'),

    initialize: function() {
        _.bindAll(this, 'start', 'load_map','polygon_click', 'show_report', 'update_dates');
        loader.loading('Vizzualization::initialize', 'loading data');
        // initial data
        this.available_layers = new LayerCollection();
        this.reports = new ReportCollection();
        this.load_map();
    },

    load_map: function() {
        var self = this;
        // create map
        this.map = new MapView({el: this.$("#main_map")});
        this.map.map.setCenter(new google.maps.LatLng(-6.348056476859352, -57.88696289062));
        this.map.bind('ready', this.start);

        // widgets
        this.stats = new StatiticsInfo();
        this.popup = new MapPopup();
        this.searchbox = new Searchbox();
        this.report_dialog = new ReportDialog({ reports: this.reports });
        this.time_range = new TimeRange({reports: this.reports});
        this.report_stats = new ReportStatCollection();
        this.create_polygon_tool = new  PolygonDrawEditTool({mapview: this.map});
        this.tools = new Toolbar({draw_tool: this.create_polygon_tool});

        this.create_polygon_tool.bind('polygon_click', function(path) {
            console.log(path);
        });

        // binding
        this.stats.bind('show_report', this.show_report);
        this.popup.bind('show_report', this.show_report);
        this.map.bind('click', function() { self.popup.close(); });
        this.map.bind('click', function() { self.searchbox.close(); });
        this.tools.bind('show_report', this.show_report);

        loader.finished('Vizzualization::initialize');
    },

    start: function() {
        var self = this;
        // load layers in map
        this.map.layers.reset(this.available_layers.models);

        this.report_dialog.regions = _(self.REPORT_LAYERS).map(function(a) {
                return self.available_layers.get_by_name(a).toJSON();
         });

        this.time_range.bind('range_change', this.report_dialog.set_reports);
        this.time_range.bind('range_change', this.update_dates);
        this.time_range.bind('range_change', this.stats.range_change);
        this.time_range.trigger('range_change', this.time_range.get_report_range());
        // show default layers
        this.map.layers.get_by_name('Legal Amazon').set_enabled(true);
        this.map.layers.get_by_name('polygons').set_enabled(true);

        this.prepare_ft_layers();
        this.searchbox.bind('goto', this.map.set_center);
    },

    // update timerange dates
    update_dates: function(reports) {
        $('#report_from').val(format_date(reports[0].get('start')));
        $('#report_to').val(format_date(_(reports).last().get('end')));
    },

    // add click listener to fusion tables layers
    prepare_ft_layers: function() {
        var self = this;
        // areas layers
        var layers = [
          'Municipalities',
          'States',
          'Federal Conservation',
          'State Conservation'
        ];
        _(layers).each(function(layer_name) {
            var state = self.map.layers.get_by_name(layer_name);
            self.state_conservation_layer = new FusionTablesLayer({
                mapview: self.map,
                layer: state.map_layer,
                table: state.get('table')
            });
            self.state_conservation_layer.bind('polygon_click', self.polygon_click);
        });
        // polygon layer
        var pl = self.map.layers.get_by_name('polygons');
        self.polygons_layer = new PolygonsLayer({
            map: self.map,
            layer: pl,
            initial_range: self.time_range.get_report_range()
        });
        this.time_range.bind('update_range', self.polygons_layer.range_changed);
    },

    polygon_click: function(data) {
        var self = this;
        var pos = this.map.projector.transformCoordinates(data.latLng);
        var reports = this.time_range.get_report_range();
        loading_small.loading('fetching stats');
        self.report_stats.stats_for_periods(reports, data.table + '_' + data.row.name.value, function(stats) {
            if(stats === undefined) {
                show_error('There was a problem getting stats for this area');
            } else {
                self.popup.showAt(pos, data.table, data.row.name.value, data.row.description.value, '23.291', stats.def,  stats.deg);
            }
            loading_small.finished('fething stats');
        });
        //this.stats.set_info(10, 20);
        //this.stats.set_location('polygon (' + row.latLng.lat().toFixed(3) + "," + row.latLng.lng().toFixed(3) + ")");
    },

    show_report: function(report_info) {
        this.report_dialog.show(report_info);
    }


});
