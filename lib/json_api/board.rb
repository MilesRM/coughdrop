module JsonApi::Board
  extend ::NewRelic::Agent::MethodTracer
  extend JsonApi::Json
  
  TYPE_KEY = 'board'
  DEFAULT_PAGE = 25
  MAX_PAGE = 50
  
  def self.build_json(board, args={})
    json = {} #board.settings
    json['id'] = board.global_id
    json['key'] = board.key
    ['grid', 'name', 'description', 'image_url', 'buttons', 'stars', 'forks', 'word_suggestions'].each do |key|
      json[key] = board.settings[key]
    end
    self.trace_execution_scoped(['json/board/license']) do
      json['license'] = OBF::Utils.parse_license(board.settings['license'])
    end
    json['created'] = board.created_at.iso8601
    json['updated'] = board.settings['last_updated'] || board.updated_at.iso8601
    # TODO: check for updated/newly-added launch URLs for app-launching buttons
    # This checks for updated/newly-added launch URLs for previously-defined apps
    self.trace_execution_scoped(['json/board/apps']) do
      json['buttons'].each do |button|
        if button['apps']
          button['apps'] = AppSearcher.update_apps(button['apps'])
        end
      end
    end
    json['link'] = "#{JsonApi::Json.current_host}/#{board.key}"
    json['public'] = !!board.public
    json['full_set_revision'] = board.full_set_revision
    json['brand_new'] = board.created_at < 1.hour.ago
    json['non_author_uses'] = board.settings['non_author_uses']
    json['total_buttons'] = board.settings['total_buttons']
    json['unlinked_buttons'] = board.settings['unlinked_buttons']
    json['downstream_boards'] = (board.settings['downstream_board_ids'] || []).length
    json['user_name'] = board.cached_user_name
    self.trace_execution_scoped(['json/board/parent_board']) do
      json['parent_board_id'] = board.parent_board && board.parent_board.global_id
      json['parent_board_key'] = board.parent_board && board.parent_board.key
    end
    json['link'] = "#{JsonApi::Json.current_host}/#{board.key}"
    
    if args.key?(:permissions)
      self.trace_execution_scoped(['json/board/permissions']) do
        json['permissions'] = board.permissions_for(args[:permissions])
        json['starred'] = board.starred_by?(args[:permissions])
      end
    end
    
    if json['permissions'] && json['permissions']['edit']
      self.trace_execution_scoped(['json/board/share_users']) do
        shared_users = board.shared_users
        json['shared_users'] = shared_users
      end
    end
    
    json
  end
  
  def self.extra_includes(board, json, args={})
    self.trace_execution_scoped(['json/board/images_and_sounds']) do
      json['images'] = board.button_images.map{|i| JsonApi::Image.as_json(i, args) }
      json['sounds'] = board.button_sounds.map{|s| JsonApi::Sound.as_json(s, args) }
    end
    if args.key?(:permissions)
      self.trace_execution_scoped(['json/board/copy_check']) do
        copy = board.copy_by(args[:permissions])
        if copy
          json['board']['copy'] = {
            'id' => copy.global_id,
            'key' => copy.key
          }
        end
      end
      self.trace_execution_scoped(['json/board/parent_board_check']) do
        parent = board.parent_board
        if parent
          json['board']['original'] = {
            'id' => parent.global_id,
            'key' => parent.key
          }
        end
      end
    end
    json
  end
end
