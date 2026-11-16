//! Pure window-placement math, kept free of Tauri types so it is unit-testable.
//! All coordinates are physical pixels in virtual-desktop space.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl Rect {
    fn intersection_area(&self, o: &Rect) -> i64 {
        let x1 = self.x.max(o.x);
        let y1 = self.y.max(o.y);
        let x2 = (self.x + self.w).min(o.x + o.w);
        let y2 = (self.y + self.h).min(o.y + o.h);
        if x2 <= x1 || y2 <= y1 {
            0
        } else {
            (x2 - x1) as i64 * (y2 - y1) as i64
        }
    }
}

/// Bottom-right of a work area (which already excludes the taskbar), inset by
/// `margin` physical pixels.
pub fn bottom_right(work: Rect, w: i32, h: i32, margin: i32) -> (i32, i32) {
    let w = w.min(work.w);
    let h = h.min(work.h);
    (
        work.x + work.w - w - margin.min(work.w - w).max(0),
        work.y + work.h - h - margin.min(work.h - h).max(0),
    )
}

/// Keep `r` entirely inside `work`, shrinking only if it is larger than the area.
pub fn clamp_into(r: Rect, work: Rect) -> Rect {
    let w = r.w.min(work.w);
    let h = r.h.min(work.h);
    Rect {
        x: r.x.clamp(work.x, work.x + work.w - w),
        y: r.y.clamp(work.y, work.y + work.h - h),
        w,
        h,
    }
}

/// Decide where the overlay opens.
///
/// A saved rectangle is reused when most of it is still on a connected
/// monitor's work area (then nudged fully inside that monitor). Otherwise —
/// monitor unplugged, resolution changed, first launch — the overlay goes to
/// the bottom-right of the primary work area.
pub fn resolve(
    saved: Option<Rect>,
    work_areas: &[Rect],
    primary: Rect,
    default_size: (i32, i32),
    margin: i32,
) -> Rect {
    if let Some(s) = saved {
        let area = s.w as i64 * s.h as i64;
        let best = work_areas
            .iter()
            .map(|wa| (wa, s.intersection_area(wa)))
            .max_by_key(|(_, a)| *a);
        if let Some((wa, visible)) = best {
            if area > 0 && visible * 2 >= area {
                return clamp_into(s, *wa);
            }
        }
    }
    let (w, h) = default_size;
    let (x, y) = bottom_right(primary, w, h, margin);
    Rect {
        x,
        y,
        w: w.min(primary.w),
        h: h.min(primary.h),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PRIMARY: Rect = Rect {
        x: 0,
        y: 0,
        w: 1920,
        h: 1032, // 1080 minus a 48px taskbar
    };
    const SECOND: Rect = Rect {
        x: 1920,
        y: 0,
        w: 2560,
        h: 1400,
    };

    #[test]
    fn first_launch_goes_bottom_right_with_margin() {
        let r = resolve(None, &[PRIMARY], PRIMARY, (400, 150), 24);
        assert_eq!(
            r,
            Rect {
                x: 1920 - 400 - 24,
                y: 1032 - 150 - 24,
                w: 400,
                h: 150
            }
        );
    }

    #[test]
    fn saved_position_on_second_monitor_is_kept() {
        let saved = Rect {
            x: 2500,
            y: 300,
            w: 420,
            h: 160,
        };
        assert_eq!(
            resolve(Some(saved), &[PRIMARY, SECOND], PRIMARY, (400, 150), 24),
            saved
        );
    }

    #[test]
    fn unplugged_monitor_falls_back_to_primary() {
        let saved = Rect {
            x: 2500,
            y: 300,
            w: 420,
            h: 160,
        };
        let r = resolve(Some(saved), &[PRIMARY], PRIMARY, (400, 150), 24);
        assert_eq!((r.x, r.y), (1920 - 400 - 24, 1032 - 150 - 24));
    }

    #[test]
    fn partially_offscreen_is_nudged_inside() {
        let saved = Rect {
            x: 1600,
            y: 900,
            w: 400,
            h: 150,
        };
        let r = resolve(Some(saved), &[PRIMARY], PRIMARY, (400, 150), 24);
        assert_eq!(
            r,
            Rect {
                x: 1520,
                y: 882,
                w: 400,
                h: 150
            }
        );
    }

    #[test]
    fn mostly_offscreen_resets() {
        let saved = Rect {
            x: 1850,
            y: 1000,
            w: 400,
            h: 150,
        };
        let r = resolve(Some(saved), &[PRIMARY], PRIMARY, (400, 150), 24);
        assert_eq!((r.x, r.y), (1496, 858));
    }

    #[test]
    fn tiny_work_area_never_produces_negative_offsets() {
        let tiny = Rect {
            x: 0,
            y: 0,
            w: 300,
            h: 100,
        };
        let r = resolve(None, &[tiny], tiny, (400, 150), 24);
        assert_eq!(
            r,
            Rect {
                x: 0,
                y: 0,
                w: 300,
                h: 100
            }
        );
    }
}
