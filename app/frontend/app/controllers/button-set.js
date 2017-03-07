import Ember from 'ember';
import modal from '../utils/modal';
import persistence from '../utils/persistence';
import i18n from '../utils/i18n';
import progress_tracker from '../utils/progress_tracker';

export default modal.ModalController.extend({
  opening: function() {
    this.set('saving_translations', null);
    this.set('error_saving_translations', null);
    if(persistence.get('online') && this.get('model.button_set')) {
      this.get('model.button_set').reload();
    }
    this.set('translating', null);

    if(this.get('model.locale') && this.get('model.button_set')) {
      var _this = this;
      _this.set('translating', {loading: true});

      var lists = [];
      var list = [];
      var promises = [];
      list.push({label: this.get('model.board.name')});
      (this.get('model.button_set.buttons') || []).forEach(function(b, idx) {
        if(b.locale != _this.get('model.locale')) {
          list.push(b);
        }
        if(list.length >= 100) {
          lists.push(list);
          list = [];
        }
      });
      _this.set('translations', {});
      if(list.length > 0) { lists.push(list); }

      lists.forEach(function(buttons) {
        var words = [];
        buttons.forEach(function(b) {
          if(b.label) {
            words.push(b.label);
          }
          if(b.vocalization && b.vocalization != b.label) {
            words.push(b.vocalization);
          }
        });
        promises.push(persistence.ajax('/api/v1/users/self/translate', {
          type: 'POST',
          data: {
            words: words,
            destination_lang: _this.get('model.locale'),
            source_lang: _this.get('model.board.locale') || 'en'
          }
        }).then(function(data) {
          var trans = _this.get('translations');
          for(var key in data.translations) {
            trans[key] = data.translations[key];
          }
          _this.set('translation_index', (_this.get('translation_index') || 0) + 1);
        }));
      });
      Ember.RSVP.all_wait(promises).then(function(res) {
        _this.set('translating', {done: true});
      }, function(err) {
        _this.set('translating', {error: true});
      });
    }
  },
  destination_language: function() {
    return i18n.readable_language(this.get('model.locale'));
  }.property('model.locale'),
  sorted_buttons: function() {
    var words = this.get('model.button_set.buttons') || [];
    var res = [];
    var locale = this.get('model.locale');
    var board_ids = this.get('model.old_board_ids_to_translate');
    var translations = this.get('translations') || {};
    var original_board_id = this.get('model.board.id');
    var translating = !!(this.get('translating'));
    words.forEach(function(b, idx) {
      if(translating) {
        if(locale && b.locale && b.locale == locale) { return; }
        if(board_ids && board_ids.indexOf(b.board_id) == -1) { return; }
        if(!board_ids && b.board_id != original_board_id) { return; }
      }
      b.label = b.vocalization || b.label;
      words.forEach(function(b2, idx2) {
        b2.label = b2.vocalization || b2.label;
        if(b.label.toLowerCase() == b2.label.toLowerCase() && idx != idx2) {
          b.repeat = true;
        }
      });
      res.push(b);
    });
    res = res.sort(function(a, b) { if(a.label.toLowerCase() < b.label.toLowerCase()) { return -1; } else if(a.label.toLowerCase() > b.label.toLowerCase()) { return 1; } else { return 0; } });
    return res;
  }.property('model.button_set.buttons', 'model.locale', 'model.board_ids'),
  update_sorted_buttons: function() {
    var _this = this;
    var translations = _this.get('translations') || {};
    if(translations[_this.get('model.board.name')]) {
      _this.set('model.board.translated_name', translations[_this.get('model.board.name')]);
    }
    (_this.get('sorted_buttons') || []).forEach(function(b) {
      if(translations[b.label]) {
        Ember.set(b, 'translation', translations[b.label]);
      }
      if(b.vocalization && b.vocalization != b.label && translations[b.vocalization]) {
        Ember.set(b, 'secondary_translation', translations[b.vocalization]);
      }
    });
  }.observes('sorted_buttons', 'translation_index', 'translating.done'),
  sorted_filtered_buttons: function() {
    var list = this.get('sorted_buttons') || [];
    var res = list;
    if(this.get('filter') == 'repeats') {
      res = list.filter(function(w) { return w.repeat; });
    }
    return res;
  }.property('sorted_buttons', 'filter'),
  show_all: function() {
    return this.get('filter') != 'repeats';
  }.property('filter'),
  show_repeats: function() {
    return this.get('filter') == 'repeats';
  }.property('filter'),
  actions: {
    download_list: function() {
      var element = document.createElement('a');
      var words = this.get('sorted_filtered_buttons').mapBy('label').uniq();
      element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(words.join("\n")));
      element.setAttribute('download', this.get('model.board.key').replace(/\//, '-') + '-words.txt');

      element.style.display = 'none';
      document.body.appendChild(element);

      element.click();

      document.body.removeChild(element);
    },
    filter: function(type) {
      this.set('filter', type);
    },
    save_translations: function() {
      var _this = this;
      _this.set('saving_translations', true);
      _this.set('error_saving_translations', null);
      var translations = {};
      if(_this.get('model.board.translated_name')) {
        translations[_this.get('model.board.name')] = _this.get('model.board.translated_name');
      }
      _this.get('sorted_buttons').forEach(function(b) {
        if(Ember.get(b, 'translation')) {
          translations[Ember.get(b, 'label')] = Ember.get(b, 'translation');
        }
        if(Ember.get(b, 'secondary_translation')) {
          translations[Ember.get(b, 'vocalization')] = Ember.get(b, 'secondary_translation');
        }
      });
      persistence.ajax('/api/v1/boards/' + _this.get('model.copy.id') + '/translate', {
        type: 'POST',
        data: {
          source_lang: _this.get('model.board.locale'),
          destination_lang: _this.get('model.locale'),
          translations: translations,
          board_ids_to_translate: _this.get('model.new_board_ids_to_translate')
        }
      }).then(function(res) {
        progress_tracker.track(res.progress, function(event) {
          if(event.status == 'errored') {
            _this.set('saving_translations', null);
            _this.set('error_saving_translations', true);
          } else if(event.status == 'finished') {
            _this.set('saving_translations', null);
            _this.set('error_saving_translations', null);
            modal.close({translated: true});
          }
        });
      }, function(res) {
        _this.set('saving_translations', null);
        _this.set('error_saving_translations', true);
      });
    }
  }
});
